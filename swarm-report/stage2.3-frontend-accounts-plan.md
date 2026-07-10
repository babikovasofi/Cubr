# Plan: Этап 2.3 — фронт: аккаунты   (slug: stage2.3-frontend-accounts)

## TL;DR
Аккаунты во `frontend/` на бэке 2.2: экраны register/login/verify/forgot+reset, онбординг
(камера-чек; регистрация кубика = placeholder до 2.4), профиль (ник/аватар-URL/рекорды/история),
соло-результат уходит на сервер. **Backend-подзадача (сначала):** минимальный `POST/GET /solves`
API + OAuth-callback на реальный роут + сверка email-ссылок. **Same-origin proxy** — Vite dev-proxy
`/api`→бэк (обязательно: httpOnly `SameSite=Lax` cookie и OAuth-редирект иначе не работают).
Порядок: **backend agent → frontend agent** (контракт `/solves` нужен фронту).

## Acceptance criteria (observable; /review проверяет)
1. Регистрация `/register` (email+пароль+ник) → экран «подтвердите почту»; токен из письма
   (EmailSpy в тестах); `/verify?token=…` → `POST /api/auth/verify` → аккаунт verified.
2. `/login` верными creds ставит httpOnly `cubr_auth` cookie → `/` (или `/onboarding` при первом
   входе); неверный пароль — RU-ошибка; неверифицированный — ветка «подтвердите + переслать».
3. «Войти через Google» → `GET /api/auth/google/authorize` → Google → callback-редирект возвращает
   в приложение залогиненным (cookie стоит) — работает через proxy (same-origin, Lax выживает).
4. Forgot (`/forgot-password`) → нейтральное «если адрес есть, отправили» (без enumeration);
   `/reset-password?token=…` с двумя совпадающими паролями → `POST /api/auth/reset-password`.
5. Онбординг 3 шага; камера-чек переиспользует `useCamera`+`useHands` (finish только когда камера+руки
   работают; skip с предупреждением); регистрация кубика — подписанный placeholder.
6. `/profile` — ник, аватар, рекорд (best single из `/users/me`), история из `GET /api/solves`;
   правка ника/аватар-URL через `PATCH /api/users/me`.
7. Завершённая соло-сборка авторизованным → `POST /api/solves` (scramble, time_ms, status valid|dnf,
   verify_frames_ok) → 201 → появляется в истории. Аноним — соло работает, POST нет.
8. `POST /api/solves` без cookie → 401; `GET /api/solves` — только свои сборки.
9. `cd backend && uv run pytest` + `cd frontend && npm run test && npm run typecheck && npm run lint` — зелёные.

## Plan (merged: planner + skeptic HIGH/MED/LOW)

### A. Backend — minimal solves API + auth-твики (agent: python-fastapi, ПЕРВЫМ)
- **`models/solve.py`** — **[skeptic HIGH / planner]** сменить `postgresql.UUID` на портируемый
  `fastapi_users_db_sqlalchemy.generics.GUID` (на Postgres = native UUID, схема 0001 не меняется;
  на sqlite = CHAR(32) → эндпоинт юнит-тестируем). Alembic не трогаем. Проверить import-путь GUID.
- **`schemas/solve.py`** — NEW `SolveCreate(scramble:str≤512, time_ms:int>0, status:Literal[valid,dnf]
  =valid, verify_frames_ok:bool=False)` (client НЕ может слать `rejected` — server-only); `SolveRead`.
- **`routers/solves.py`** — NEW. `POST /solves` (`Depends(current_active_user)`+session): insert
  Solve(user_id=user.id), commit, 201 SolveRead; если `valid` и быстрее — обновить `user.best_single_ms`.
  `GET /solves` (limit=50, offset): только свои, `created_at desc`.
- **`main.py`** — include solves router (без `/api`-префикса — proxy стрипает `/api`, бэк на root).
- **`routers/auth.py`** — **[skeptic MED OAuth]** callback редиректит на реальный роут со статусом:
  `FRONTEND_URL/auth/callback?ok=1` / `?error=<code>` (не голый root) — чтобы SPA распарсил.
- **`services/email.py`** — **[skeptic MED verify/reset]** проверить/поправить, что письма строят
  ссылки на **фронт**: `FRONTEND_URL/verify?token=` и `FRONTEND_URL/reset-password?token=` (токен в body).
- **`tests/conftest.py`** — добавить `Solve.__table__` в `create_all` (теперь рендерится на sqlite).
- **`tests/test_solves.py`** — NEW: anon 401; authed POST 201+persist; GET только свои; `best_single_ms`
  обновляется лишь когда `valid` быстрее текущего; `rejected`/invalid отбит схемой.

### B. Frontend — proxy + API + стор + роуты + страницы (agent: react-ts, ПОСЛЕ backend)
- **`vite.config.ts`** — **[skeptic HIGH]** `server.proxy` `/api`→`http://127.0.0.1:8000`,
  `changeOrigin:true`, `rewrite: p=>p.replace(/^\/api/,"")`. Фронт фетчит ТОЛЬКО относительный `/api/...`,
  никаких абсолютных URL бэка.
- **`vercel.json`** — NEW **[skeptic HIGH prod]** rewrite `/api/(.*)`→`<BACKEND_URL>/$1` (плейсхолдер +
  коммент): в проде Vercel/Railway = разные origin, Lax-cookie ходит только через same-host rewrite.
  Реальный backend-URL проставляется на деплое (Этап 2.6). Прод-CORS-creds не полагаемся.
- **`src/api/client.ts`** — NEW `request()` (base `/api`, `credentials:"include"`, JSON + form-urlencoded
  для login). **[skeptic MED]** парсит fastapi-users ошибки (`{detail}` строка ИЛИ `{detail:{code,reason}}`)
  → `ApiError{status,code,message}`; RU-мэппинг LOGIN_BAD_CREDENTIALS, LOGIN_USER_NOT_VERIFIED,
  REGISTER_USER_ALREADY_EXISTS, RESET_PASSWORD_BAD_TOKEN, VERIFY_USER_BAD_TOKEN, REGISTER_INVALID_PASSWORD, 429.
- **`src/api/auth.ts`** — NEW: register/login(**form-urlencoded, поле `username`=email**)/logout/verify/
  requestVerify/forgotPassword/resetPassword/getMe/updateMe/googleAuthorizeUrl.
- **`src/api/solves.ts`** — NEW: createSolve, listSolves. Типы зеркалят backend SolveRead.
- **`src/store/authStore.ts`** — NEW zustand: `user|null`, `status: loading|authed|anon`.
  **[skeptic MED session-probe]** `bootstrap()` = `getMe` один раз на старте (401 ⇒ anon, без console-шума,
  401 — норма не ошибка). login/register/logout/refreshMe.
- **`src/auth/ProtectedRoute.tsx`** + `GuestOnlyRoute` — **[skeptic MED]** пока `loading` — спиннер (без
  вспышки контента); anon → `<Navigate to="/login?next=<path>">`; после логина — на `next`.
- **`src/App.tsx`** — роуты /register,/login,/verify,/forgot-password,/reset-password (guest),
  /auth/callback (probe /users/me по возврату OAuth), /onboarding,/profile (protected). Header: cups+avatar-меню
  (профиль/настройки-placeholder/logout) если authed, иначе Войти/Регистрация. `bootstrap()` на mount.
- **`src/components/Input.tsx`**, **`Toast.tsx`** — NEW (design §5.4/§5.9), минимальные.
- **Страницы** (NEW): `LoginPage` (bad-creds, LOGIN_USER_NOT_VERIFIED→resend-ветка, забыл-пароль, Google,
  redirect→next/`/`), `RegisterPage` (+resend, rate-limited, Google), `VerifyEmailPage` (?token→auto-POST,
  success/fail/expired), `ForgotPasswordPage` (нейтральный ответ), `ResetPasswordPage` (?token, 2 пароля),
  `OnboardingPage` (3 шага, камера-чек на `useCamera`+`useHands`, cube-placeholder), `ProfilePage`
  (getMe+listSolves, аватар-URL правка, records: best single; ao5/cups как есть/`—`, пустая история).
- **`src/solo/useSoloSession.ts`** — на входе в `result`, если `authStore.isAuthed` → `createSolve({scramble,
  time_ms:round(elapsedMs), status: dnf?"dnf":"valid", verify_frames_ok:!dnf})`. Fire-and-forget + saved/failed
  флаг. Аноним — no-op. **[skeptic LOW jwt-expiry]** на 401-после-истечения не терять результат: локально
  сохранить + предложить релогин.
- **`src/solo/ResultScreen.tsx`** — «результат сохранён» / «войдите, чтобы сохранять» по флагу.

### Tests
- backend `test_solves.py` (см. A).
- frontend vitest (node, mocked fetch): `client.ts` мэппит каждый fastapi-users код + 429 в RU;
  login шлёт `application/x-www-form-urlencoded` с `username`; authStore loading→authed/anon на bootstrap;
  solo-save helper строит правильный payload (round time_ms, dnf→status/verify_frames_ok) и skip при anon.
- Manual/smoke: полный цикл register→verify→login→onboarding→solo-save→profile против локального бэка;
  Google-redirect возвращает залогиненным; verify/reset-ссылки end-to-end.

## Blockers
Решений за пользователя нет. Разрешённые дизайном HIGH-и: (1) proxy — dev vite-proxy в 2.3 (load-bearing),
prod `vercel.json` шаблон + документируется на деплой 2.6; (2) `/solves` — backend-подзадача включена в 2.3
(не «фронт-онли»); (3) аватар — **URL-строка** в 2.3 (без загрузки файла — storage нет).
Ник — **не уникальный** в 2.3 (в бэке нет constraint), документируется.

## Out of scope
- Регистрация кубика / захват цвет-профиля / таблица `cubes` — **Этап 2.4** (placeholder-карточка).
- Внутренности настроек (смена пароля, link/unlink Google, удаление аккаунта, калибровка) — §8, link/placeholder.
- Дуэль/турнир/лидерборд/матчмейкинг/Ao5/начисление кубков/статус соперника.
- Прод-proxy финальная настройка (Vercel rewrite с реальным URL) — Этап 2.6.
- Загрузка файла аватара (нет storage/endpoint). Server-валидация кадров (`rejected`) — анти-чит-этап.
- Публичный профиль по нику (`/profile/:nick` — заглушка; endpoint'а нет).
- Refresh-токен (JWT 1ч; на истечение — локальный save + релогин, не теряем результат).

## Assumptions
- `/` остаётся landing/home; protected `/profile` = свой профиль через `/users/me`.
- «Первый вход → онбординг» без серверного флага — client-side localStorage `cubr_onboarded` (заметка: будущее серверное поле).
- Records: осмысленный только `best_single_ms`; `best_ao5_ms`/cups рендерятся как есть, ao5 = `—`.
- verify/reset письма ведут на фронт (`/verify?token=`, `/reset-password?token=`) → POST токена в API (стандартный fastapi-users flow).
- login — form-urlencoded (`OAuth2PasswordRequestForm`, поле `username`=email), НЕ JSON (иначе 422).
- Неверифицированный, но залогиненный (2.2: verify не гейтит логин) — баннер resend; features под verify гейтятся позже.
