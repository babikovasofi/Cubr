# Build: Этап 2.2 — авторизация (backend)   (slug: stage2.2-auth)

Plan: [stage2.2-auth-plan.md](stage2.2-auth-plan.md). Agent: `python-fastapi` (на каркасе 2.1).
fastapi-users **15.0.5**. Build оборвался на API-error после config/pyproject → дожат резюмом того же агента.

## Changed files
- `pyproject.toml` — fastapi-users[sqlalchemy,oauth]>=15, pwdlib[argon2], slowapi, httpx · `uv.lock` регенерирован
- `app/config.py` — SECRET/RESET_VERIFY_SECRET required (min32, placeholder-reject в non-local) + cookie/email/oauth/ratelimit
- `.env.example` — новые vars (плейсхолдеры)
- `app/models/user.py` — `nickname` nullable + `oauth_accounts` relationship (lazy=joined)
- `app/models/oauth_account.py` — NEW `OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID)`
- `app/models/__init__.py` — экспорт OAuthAccount
- `app/db.py` — `get_user_db` (SQLAlchemyUserDatabase w/ User+OAuthAccount)
- `app/schemas/user.py` — NEW UserRead/UserCreate/UserUpdate
- `app/services/email.py` — NEW mockable async-сендер (resend/brevo, mail-outage не 500-ит)
- `app/services/auth.py` — NEW argon2 PasswordHelper, UserManager (email-хуки + custom `oauth_callback` с email_verified-проверкой + derive nickname), CookieTransport, JWTStrategy, backend, FastAPIUsers, GoogleOAuth2
- `app/services/ratelimit.py` — NEW limits-backed IP + per-email dependencies → RateLimitExceeded
- `app/routers/auth.py` — NEW роутеры fastapi-users под /auth + /users + custom Google redirect-callback
- `app/main.py` — limiter state, 429-handler, SlowAPIMiddleware, ProxyHeadersMiddleware(trusted_proxies), include auth
- `migrations/versions/0002_oauth_accounts.py` — NEW hand-written (нет Docker)
- `tests/conftest.py` — create_all на StaticPool sqlite, email spy, rate-limiter reset, DB-inspect фикстуры
- `tests/test_auth.py` — NEW 13 кейсов
- `docs/decisions.md` — решения 2.2

## API
`POST /auth/register` (201, argon2, is_verified=false; дубль 400) · `POST /auth/login` (form → 204 + httpOnly SameSite=Lax cookie `cubr_auth`; bad 400) · `POST /auth/logout` (204, чистит) · `GET /users/me` (401 без / 200 с) · `request-verify-token`/`verify` · `forgot-password`/`reset-password` · `GET /auth/google/authorize` (200 url) · `GET /auth/google/callback` (302→FRONTEND_URL, cookie) · 429 на AUTH_RATE_LIMIT (IP) и EMAIL_RATE_LIMIT (per-email).

## Tests (проверено дважды: агент + main)
```
ruff   → All checks passed!
mypy   → Success: no issues found in 18 source files
pytest → 14 passed in 0.91s
```
Кейсы: register-argon2-unverified, dup-400, verify-email-spy×1, login-httpOnly-no-leak, bad-creds-400,
users/me 401&200, logout-clears, **unverified-can-login** (политика), verify-flow, reset-flow,
login-IP-429, register-email-429, google-authorize-url, health.

## Security-фиксы — доказаны (main спот-чек)
- **SECRET fail-closed**: unset → `Field required`; placeholder в `APP_ENV=production` → `ValueError: refusing to boot`. ✓
- Split `RESET_VERIFY_SECRET` (reset/verify ≠ auth JWT).
- **email_verified**: custom `oauth_callback` читает Google OpenID userinfo (fail-closed), ANDs `associate_by_email`/`is_verified` с verified-claim.
- **rate-limit**: dependency-механизм (декоратор не композится с fastapi-users), client-IP через `ProxyHeadersMiddleware(trusted_hosts=TRUSTED_PROXIES)` — не сырой XFF; отдельный per-email лимит на register/forgot/request-verify.
- Cookie: httponly, secure=(APP_ENV≠local), samesite=lax, max_age=JWT_LIFETIME.
- Verification НЕ гейтит логин (по плану).

## Осталось (manual — нет Docker)
- **Живая миграция**: 0002 hand-written под `SQLAlchemyBaseOAuthAccountTableUUID`, offline `--sql` корректен (FK ON DELETE CASCADE, 3 индекса, ALTER user nickname DROP NOT NULL). Нужен `docker-compose up -d && uv run alembic upgrade head` против Postgres.
- **Живые ключи**: реальный Resend/Brevo send, реальный Google OAuth round-trip.
- **2.3 фронт**: same-origin proxy — фронт должен проксировать `/api` под одним origin (иначе SameSite=Lax cookie и OAuth-редирект не сработают).
