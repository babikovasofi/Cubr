# Plan: Этап 2.2 — авторизация (backend)   (slug: stage2.2-auth)

## TL;DR
На каркасе 2.1: fastapi-users **15** — регистрация email+пароль (**argon2** через pwdlib),
логин с **JWT в httpOnly cookie**, email-подтверждение (Resend/Brevo API), сброс пароля,
**Google OAuth** (`oauth_accounts`), **slowapi** rate-limit. Backend only (фронт-экраны — 2.3).
**Топология: same-origin proxy** (фронт проксирует `/api` на бэк) → cookie `SameSite=Lax`+`Secure`,
CSRF-middleware не нужен.

## Acceptance criteria (observable; /review проверяет)
1. `POST /auth/register` → 201, в БД argon2-хеш (`$argon2` в `hashed_password`), `is_verified=false`; дубль email → 400.
2. `POST /auth/login` верные креды → httpOnly cookie с JWT (`Secure` в non-local, `SameSite=Lax`, `max_age=JWT_LIFETIME`); неверные → 400; в теле нет bearer-утечки.
3. `GET /users/me` → 401 без cookie, 200 с cookie; `POST /auth/logout` чистит cookie.
4. Регистрация вызывает отправку verify-письма (мокаемый async-клиент, ровно 1 раз с токеном); `request-verify-token` + `verify` с токеном → `is_verified=true`.
5. Сброс: `forgot-password` шлёт письмо; `reset-password` с токеном меняет хеш; старый пароль → 400, новый логинится.
6. `GET /auth/google/authorize` → 200 с URL на `accounts.google.com`; callback после успеха апсертит `oauth_accounts` и **редиректит на `FRONTEND_URL`** (не 204).
7. Превышение `AUTH_RATE_LIMIT` с одного IP → 429; под лимитом → проходит. Email-эндпоинты (register/forgot/request-verify) имеют **отдельный жёсткий лимит по target-email**.
8. `alembic upgrade head` создаёт `oauth_accounts` (autogenerate); `pytest`/`mypy app`/`ruff` зелёные.

## Plan (merged: planner + skeptic HIGH/MED/LOW фиксы)

### Security-фиксы (skeptic HIGH/MED) — обязательны
- **[HIGH] `SECRET` fail-closed** (`config.py`): убрать хардкод-дефолт → required (нет значения = `ValidationError` при старте); `min_length>=32`; в `APP_ENV!=local` assert ≠ placeholder. **[LOW]** отдельный `RESET_VERIFY_SECRET` (сплит от auth-JWT-секрета). Генерить `secrets.token_urlsafe(48)`.
- **[HIGH] OAuth nickname NOT NULL 500**: `oauth_callback` fastapi-users создаёт юзера только с `email/hashed_password/is_verified` — `nickname` не передаётся → INSERT падает. Фикс: `nickname` **nullable + server_default** ИЛИ override `UserManager.oauth_callback`/`create` с derive-ником из email. Выбрать nullable+derive в хуке (не полагаться на UserCreate-схему — OAuth её минует).
- **[HIGH] OAuth callback UX**: сток-роутер отдаёт `204 No Content` → браузер застревает. Custom-wrapper: после `backend.login` (cookie выставлен) вернуть `RedirectResponse(FRONTEND_URL)`. Явный `redirect_url`.
- **[MED] `email_verified` claim**: `is_verified_by_default=True`+`associate_by_email=True` доверяют email провайдера. httpx-oauth Google НЕ проверяет `email_verified` → account takeover. Фикс: проверять claim перед associate/verify (override извлечения email) ИЛИ `associate_by_email=False`. Взять: проверку claim в кастомном `oauth_callback`.
- **[MED] rate-limit за прокси**: `get_remote_address` = IP прокси при деплое → общий бакет. Фикс: client-IP из `X-Forwarded-For` с trusted-proxy allowlist (Starlette `ProxyHeadersMiddleware`), не сырой XFF. **Отдельные лимиты** на email-эндпоинты по target-email (register/forgot 3/hour) сверх IP-лимита.
- **[MED] slowapi механизм прибить первым**: `Limiter.limit` — декоратор, не композится с fastapi-users роутерами. Механизм: глобальный `SlowAPIMiddleware` + `default_limits`, ИЛИ реальная dependency, вручную зовущая `limiter._check_request_limit` и кидающая `RateLimitExceeded`. **Собрать и проверить тестом 429 ДО остального.**
- **[MED] verify-gating политика**: по умолчанию в 2.2 verification **НЕ блокирует** логин (соло-сборка доступна неверифицированным — меньше трения для MVP); флаг `is_verified` несём для будущих гейтов (дуэли/турнир). Задокументировать; тест на «неверифицированный логинится» (текущая политика).
- **[MED] миграция 0002 autogenerate** (не hand-write): `alembic revision --autogenerate` против `OAuthAccount`, вычитать; проверить `user_id` FK `ondelete=CASCADE`.

### Файлы
- `backend/pyproject.toml` — **[LOW]** bump `fastapi-users[sqlalchemy,oauth]>=15`; `pwdlib[argon2]` (argon2-cffi); `slowapi`; email-клиент (reuse `httpx`). Регенерить `uv.lock`.
- `backend/app/config.py` — `JWT_LIFETIME_SECONDS`(3600), `SECRET`(required), `RESET_VERIFY_SECRET`(required), `COOKIE_NAME`, `COOKIE_SECURE`(derive `APP_ENV!=local`), `COOKIE_SAMESITE`("lax"), `FRONTEND_URL`, `EMAIL_FROM`, `EMAIL_PROVIDER`("resend"|"brevo"), `RESEND_API_KEY`/`BREVO_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URL`, `AUTH_RATE_LIMIT`("10/minute"), `TRUSTED_PROXIES`.
- `backend/.env.example` — все новые vars с плейсхолдерами (без реальных секретов).
- `backend/app/models/oauth_account.py` — NEW `OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base)`.
- `backend/app/models/user.py` — `oauth_accounts: Mapped[list[OAuthAccount]] = relationship(lazy="joined")` (import под `TYPE_CHECKING`); `nickname` nullable.
- `backend/app/models/__init__.py` — экспорт `OAuthAccount` (alembic видит metadata).
- `backend/app/db.py` — `get_user_db` → `SQLAlchemyUserDatabase(session, User, OAuthAccount)`.
- `backend/app/schemas/user.py` — NEW `UserRead(BaseUser[UUID]+app-поля)`, `UserCreate(BaseUserCreate+nickname опц.)`, `UserUpdate`.
- `backend/app/services/email.py` — NEW async-сендер (`send_verification_email`/`send_reset_email`), провайдер-свитч, httpx AsyncClient, ловит/логирует ошибки (mail-outage не 500-ит auth), awaitable для мока.
- `backend/app/services/auth.py` — NEW: argon2 `PasswordHelper` (pwdlib), `UserManager(UUIDIDMixin, BaseUserManager)` с секретами reset/verify=`RESET_VERIFY_SECRET`, хуки `on_after_register`→request-verify, `on_after_request_verify`→email, `on_after_forgot_password`→email, кастомный `oauth_callback` (email_verified-проверка + derive nickname); `get_user_manager`; `CookieTransport(httponly=True, secure, samesite, max_age=JWT_LIFETIME)`; `JWTStrategy(SECRET, lifetime)`; `AuthenticationBackend`; `FastAPIUsers`; `current_active_user`; `GoogleOAuth2`.
- `backend/app/services/ratelimit.py` — NEW slowapi `Limiter` (key_func с XFF+trusted-proxy) + email-эндпоинт лимитер.
- `backend/app/routers/auth.py` — NEW: сборка роутеров fastapi-users под `/auth` (+ `/users`), каждый с rate-limit dependency; OAuth-роутер с кастомным redirect-callback.
- `backend/app/main.py` — `app.state.limiter`, `SlowAPIMiddleware`, `ProxyHeadersMiddleware`, `RateLimitExceeded`→429, `include_router(auth)`. CORS уже `allow_credentials=True`.
- `backend/migrations/versions/0002_oauth_accounts.py` — NEW autogenerate.
- `backend/tests/conftest.py` — `create_all` на sqlite-движке до yield; фикстуры register+login (authed client с cookie); мок `email`-сендеров (spy, без сети).
- `backend/tests/test_auth.py` — кейсы ниже.
- `docs/decisions.md` — argon2/pwdlib, JWT-in-cookie same-origin, `SameSite=Lax` (proxy-топология), split reset/verify secret, associate_by_email + email_verified-проверка, slowapi-механизм, verify не гейтит логин в 2.2.

### Tests
- register → 201, argon2-хеш, `is_verified=false`; дубль → 400.
- email-хук: register зовёт мок verify-сендер ровно 1 раз с токеном.
- login → httpOnly cookie; `/users/me` 401 без / 200 с; logout чистит.
- verify: токен из spy → `verify` → `is_verified=true`.
- reset: forgot (токен из spy) → reset → старый пароль 400, новый логинится.
- rate-limit: цикл сверх лимита на `/auth/login` → 429; под лимитом → не 429. Отдельный email-лимит на register/forgot.
- oauth smoke: `/auth/google/authorize` → 200, `authorization_url` содержит `accounts.google.com` (без живого Google).
- **Manual (нужен Docker+реальные ключи):** живой Resend/Brevo, реальный Google OAuth round-trip, миграция против Postgres.

## Blockers
Нет нерешённых. CSRF-топология выбрана — **same-origin proxy** (`SameSite=Lax`+`Secure`, без CSRF-middleware); деплой 2.6 должен проксировать фронт→бэк под одним origin (Vercel rewrites / reverse-proxy), задокументировать в decisions.

## Out of scope
- Все фронт-экраны auth (регистрация/вход/verify/reset UI) — 2.3.
- Онбординг/камера-чек, редактирование профиля, `POST /solves` — 2.3.
- Refresh-token flow / ротация / logout-all-devices / revocation lists.
- Redis-хранилище для rate-limit + multi-worker hardening (in-memory = per-process, ок для MVP).
- Реальная DNS/SPF/DKIM email-доставляемость.
- Другие OAuth-провайдеры кроме Google; UI линковки аккаунтов.

## Assumptions
- Пути fastapi-users дефолтные: `/auth/*` (login/logout/register/request-verify-token/verify/forgot-password/reset-password), `/auth/google/*`, `/users/me`. 2.3 консюмит.
- Провайдер Resend primary (Brevo — конфиг-свитч). SPF/DKIM — ops, не код.
- JWT-стратегия (не DB-session) в одном httpOnly cookie; access-only, без refresh в этом этапе.
- `/users/me` включён только ради «protected route works» AC; полный профиль — 2.3.
- Google — единственный OAuth-провайдер 2.2. `AUTH_RATE_LIMIT="10/minute"` по IP, тюнится env.
- verification НЕ гейтит логин в 2.2 (гейты для дуэлей/турнира — позже).
