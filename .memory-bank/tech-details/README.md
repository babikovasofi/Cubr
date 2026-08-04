# Tech Details — Cubr

> Стек, архитектура, модули. Детали: [solutions.md](solutions.md) (как решать
> зрение/реалтайм/анти-чит), [user-flow.md](user-flow.md) (экраны),
> [design-system.md](design-system.md) (дизайн).

## Стек

| Слой | Выбор | Почему |
|---|---|---|
| Фронтенд | **React + TypeScript (Vite) + Tailwind** | Лучшая экосистема для камеры/CV в браузере |
| Зрение: руки | **MediaPipe Tasks Vision — HandLandmarker (JS)** | Актуальный API (legacy `@mediapipe/hands` устарел); детект рук в браузере |
| Зрение: кубик | **Своя логика**: canvas + Lab/ΔE классификация цветов | ML/CV-зона проекта; готовых JS-решений нет |
| Кубик-логика | **cubejs** (Этап 0) → **`cubing` / twisty-player** (Этап 1) | Скрамбл→эталон + рендер/анимация ходов; `cubing` даёт и random-state, и рендер — одна зависимость. Замена cubejs при визуальном скрамбле (см. [feature-scramble-visual](../product-overview/feature-scramble-visual.md)) |
| Бэкенд | **Python + FastAPI** | WebSockets и async из коробки; серверная CV на OpenCV |
| Реалтайм | **WebSockets (FastAPI)** | Комнаты дуэлей, статусы, синхронный старт |
| БД | **PostgreSQL + SQLAlchemy** (async; локально можно с SQLite) | Реляционка: игроки, дуэли, результаты, турниры |
| Авторизация | **fastapi-users**: email+пароль (argon2) + Google OAuth, JWT в httpOnly cookies | Не писать безопасность с нуля |
| Почта | **Resend / Brevo** (не свой SMTP) + SPF/DKIM | Подтверждение/сброс не в спам |
| Планировщик | **APScheduler** | Смена скрамбла недели, финализация таблицы (ночь пн) |
| Хостинг | Фронт — **Vercel**; бэк + Postgres — **Railway / Render** | Бесплатный старт |

## Архитектура

```
Браузер (React + TS + MediaPipe JS + логика кубика)
   │  REST      — логин, профиль, результаты, лидерборд
   │  WebSocket — дуэль: матчмейкинг, статусы, старт, финиш
   │  Кадры     — ключевые снимки (JPEG) для серверной валидации
   ▼
FastAPI (Python)
   ├─ генерация скрамблов, проверка состояния кубика (OpenCV)
   ├─ валидация таймингов/последовательности событий, начисление кубков
   ├─ матчмейкинг, комнаты дуэлей (ConnectionManager: room_id → {player_id → ws})
   └─ недельные турниры (APScheduler: смена скрамбла раз в неделю)
   │
   ▼
PostgreSQL
```

Реалтайм: состояние комнаты живёт на сервере (память процесса; Redis для MVP не
обязателен). Синхронный старт по серверному сигналу 3-2-1. Heartbeat 5с, отвал
15с. Reconnect по `room_id + session_token` со снапшотом комнаты. Подробнее — [solutions.md §П6](solutions.md).

## Модель данных (набросок)

```
users:        id, email, password_hash, google_id?, nickname, avatar_url,
              cups, best_single_ms, best_ao5_ms, created_at
cubes:        id, user_id, name, note?, is_primary, color_profile JSONB (6 Lab-эталонов
              {W/Y/R/O/B/G:[L,a,b]}), created_at, recalibrated_at  -- лимит 5/аккаунт
duels:        id, mode (fast|ao5), scramble(s), player1_id, player2_id,
              status, winner_id, created_at
solves:       id, user_id, duel_id?, tournament_id?, cube_id? (FK cubes), scramble, time_ms,
              status (valid|dnf|rejected), verify_frames_ok, created_at
tournaments:  id, week_start, scramble, status
attempts:     unique(user_id, tournament_id)  — одна попытка/неделя (enforce в БД)
trophy_log:   id, user_id, delta, reason, created_at
```

## Тулчейн прототипа Этапа 0 (решено 2026-07-06)
**Vite + TypeScript** (vanilla-ts, без React — throwaway), пакеты через npm:
`@mediapipe/tasks-vision` (HandLandmarker), `cubejs`. Тесты — Vitest. Тот же
тулчейн, что Этап 1 → порт бесплатный. React/Tailwind/Zustand добавляются в Этапе 1.

**Gotcha (cubejs + Vite 8/Rolldown):** cubejs `lib/solve.js` использует
`this.Cube || require('./cube')` — top-level `this` в ESM = undefined → краш при
загрузке в браузере (dev и prod), но НЕ в Node-тестах/build. Пофикшено
`patch-package` (`prototype/patches/cubejs+1.3.2.patch`, `postinstall`).

**Gotcha (cubing + Vite):** `cubing` (заменит cubejs в Этапе 1) гоняет solver в
**module web-worker** — под Vite prod-build инстанцирование воркера падает
(«Module worker instantiation failed»; dev ок, prod нет; `worker.format:"es"` не
помог). Решение: грузить `cubing` с **CDN `cdn.cubing.net/v0/js/cubing/{scramble,twisty}`**
(remote ESM), НЕ бандлить — доказано в `prototype2/` (spike). Рантайм требует сети. MediaPipe
wasm+модель грузятся с CDN (пин 0.10.35) — рантайм требует сети. Vite биндит IPv6
по умолчанию → dev-запуск с `--host 127.0.0.1`.

## Ключевые фронт-модули (план Этапа 1)
`vision/hands.ts` (MediaPipe + зоны/неподвижность) · `vision/cube.ts` (рамка-гид,
сетка 3×3, чтение наклеек) · `vision/colors.ts` (Lab/ΔE, эталоны сессии, квоты 9×6) ·
`vision/fsm.ts` (конечный автомат: NO_HANDS→HANDS_IN_ZONE→READY→SOLVING→STOPPED).
Таймер: `performance.now()` + `requestVideoFrameCallback` (не привязан к кадрам). Состояние UI — Zustand.

## Соло-петля зрения (реализовано Этап 1.2)
`solo/soloPhase.ts` — чистый reducer фаз (scramble→walkthrough→verify→armed→solving→stopped→
result); таймер гейтится на `scrambleVerified` (FSM не идёт дальше `HANDS_IN_ZONE` без взвода);
elapsed = `stop_t − start_t` из `o.t` кадров, НЕ `performance.now()` в React-хендлере.
`solo/useSoloSession.ts` — оркестратор per-frame петли camera→hands→fsm→timer + verify-сбор 6 граней.
StrictMode-safe: все эффекты с getUserMedia/HandLandmarker/`<twisty-player>` — `cancelled`-флаг +
идемпотентные `stop()`/`close()`; rVFC — id + `cancelVideoFrameCallback` + `running`-флаг + rAF-fallback
(Firefox). Mirror = только CSS `scaleX(-1)`; выборка/оверлей в raw-координатах. `numHands:2` явно.

## Backend (реализовано Этап 2.1)
Пакетник **uv** + Python 3.12. `backend/app/{config,db,models,routers,schemas,services}`.
- `config.py` — pydantic-settings v2, один `DATABASE_URL` (`postgresql+asyncpg://`), `cors_origins`, `get_settings()`+lru_cache.
- `db.py` — `create_async_engine` + `async_sessionmaker(expire_on_commit=False)` + `Base(DeclarativeBase)` + `get_session()` Depends.
- Модели: `User(SQLAlchemyBaseUserTableUUID, Base)` — UUID PK, table `user`, `hashed_password`/`is_*` от базы
  fastapi-users (задел под 2.2 без rewrite) + app-колонки (nickname/avatar_url/cups/best_*/created_at).
  `Solve` — `status` VARCHAR (не DB-enum), `user_id` FK→user.id, `duel_id`/`tournament_id` UUID БЕЗ FK (таблицы в 3/5).
- Alembic **async** env (`connection.run_sync` в `asyncio.run`, `target_metadata=Base.metadata`, импорт `app.models`);
  `0001_init` hand-written. Postgres локально через `docker-compose` (postgres:16 + healthcheck `pg_isready`).
- CORS explicit origins + `allow_credentials=True` (без wildcard — 2.2 кладёт JWT в httpOnly cookies).
- `GET /health` — реальный `SELECT 1`. Решения зафиксированы в `docs/decisions.md`.

### Auth (реализовано Этап 2.2)
fastapi-users **15** (`app/services/{auth,email,ratelimit}.py`, `routers/auth.py`).
- Argon2 (pwdlib) хеш; JWT в **httpOnly cookie** `cubr_auth` (`SameSite=Lax`, `Secure` в non-local,
  `max_age=JWT_LIFETIME`). **Топология same-origin proxy** (фронт проксирует `/api`) → CSRF-middleware не нужен.
- Модель `OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID)`; Google OAuth с custom `oauth_callback`
  (проверяет `email_verified` claim перед associate/verify — fail-closed) + `RedirectResponse(FRONTEND_URL)`.
- Email (Resend/Brevo, `EMAIL_PROVIDER`-свитч) через httpx, mail-outage не 500-ит; мокаемо в тестах.
- Rate-limit: slowapi через **dependency** (декоратор не композится с fastapi-users роутерами);
  client-IP из XFF через `ProxyHeadersMiddleware(TRUSTED_PROXIES)`; отдельный per-email лимит на register/forgot/verify.
- **Секреты fail-closed**: `SECRET`/`RESET_VERIFY_SECRET` required, min32, reject placeholder-фрагментов
  **в любом env** (`config.py`) — забытый `APP_ENV` в проде не стартует на `.env.example`-плейсхолдерах.
- Пути: `/auth/{register,login,logout,request-verify-token,verify,forgot-password,reset-password}`,
  `/auth/google/{authorize,callback}`, `/users/me`. Verify НЕ гейтит логин в 2.2. Миграция `0002_oauth_accounts`.

### Solves API + фронт-аккаунты (реализовано Этап 2.3)
- **Backend:** `POST /solves` (auth, `{scramble,time_ms>0,status:valid|dnf,verify_frames_ok}`, апдейт
  `best_single_ms`), `GET /solves` (свои, created_at desc). `Solve.id/user_id` на портируемом
  `fastapi_users_db_sqlalchemy.generics.GUID` (native UUID на Postgres, CHAR(32) на sqlite → юнит-тесты).
  Client не может слать `status=rejected` (server-only). OAuth-callback → `FRONTEND_URL/auth/callback?ok=1|error=<code>`.
- **Same-origin proxy (load-bearing):** фронт фетчит ТОЛЬКО относительный `/api/...`; Vite dev-proxy
  `/api`→`127.0.0.1:8000` (strip `/api`), прод — `vercel.json` rewrite (host-плейсхолдер до 2.6). Иначе
  `SameSite=Lax` cookie не ходит cross-origin (Vercel≠Railway). login — **form-urlencoded** (`username`=email).
- **Frontend session:** httpOnly cookie → JS не читает auth; состояние только через `GET /users/me`-probe
  (401=норма). zustand `authStore` (`bootstrap()` латчит лишь на 200/401, ретрай на транзиентном сбое).
  `ProtectedRoute` (`?next=`, guard от open-redirect) / `GuestOnlyRoute`. `src/api/client.ts` мэпит
  fastapi-users ошибки (`string|{code,reason}`) в RU. Онбординг: localStorage `cubr_onboarded` (пока без серверного поля).

### Профили кубиков (реализовано Этап 2.4, accounts-only)
- **Backend:** таблица `cubes` (`color_profile` = `sa.JSON().with_variant(JSONB,"postgresql")`, ключи
  **позиционные грани U/R/F/D/L/B**, НЕ W/Y/R/O/B/G). `routers/cubes.py` CRUD, все инварианты server-side
  в одной транзакции: лимит 5 → 409 `CUBE_LIMIT`; ровно один `is_primary` (set сбрасывает остальные,
  первый auto, delete-primary promotes самый свежий); ownership → 404 (не 403). `solve.cube_id` FK
  `ondelete=SET NULL` (сборки переживают удаление кубика). Миграция `0003_cubes`. `POST /solves` валидирует
  `cube_id` по владельцу. MVP: инварианты read-then-write без row-lock (concurrency-гонка принята).
- **Frontend:** `cubesStore` (single-primary + promote optimistic, `selectedCubeId` persist localStorage,
  `getSelectedCubeId()` возвращает id только если он в загруженном списке — не теряет солв на stale-id).
  `CubeRegisterWizard` переиспользует `captureCalibration` (6 граней) + `useCubeReader.getProfile()`
  (ключи U/R/F/D/L/B = backend `ColorProfile`). «Мои кубики» — секция в `/profile`. Селектор в соло =
  метаданные к результату (зрение НЕ потребляет профиль — отложено на vision-интеграцию/Этап 0).

## Локализация RU/EN (реализовано, пасы 1–4)
`i18n/t.ts` — **ключ перевода = сама русская строка**, не `footer.rules`. Словарь один
(`i18n/en.ts`, `Record<string,string>`), русский словаря не имеет — это исходный текст.
Непокрытое место деградирует в русский, а не в идентификатор на экране. `useT()` — хук
(перерисовывает при смене языка), `translate(lang, key, params)` — для модулей вне
компонентов, `type T` — сигнатура для передачи переводчика параметром. Подстановки `{name}`.
Язык — `store/langStore` (persist).
- **Переводим в месте показа, не в месте создания.** Строку ошибки хук возвращает по-русски —
  это ключ; рендер зовёт `t(error)`. Чистые модули (`vision/guide.ts`, `daily/StreakBadge.tsx`)
  принимают `t: T = ruT` параметром: дефолт русский, старые вызовы и тесты не трогаются.
- **Склонения — `i18n/plural.ts`**, ключом идёт фраза целиком (в русском согласуется и глагол),
  словарь схлопывает три русские формы в две английские. Собирать фразу из переведённых кусков
  нельзя: порядок слов и согласование в языках разные.
- **Длинная проза — по файлам, не по словарю**: `pages/legal/{Rules,Privacy}{Ru,En}.tsx`.
  Два файла держим синхронно; для приватности это жёсткое требование (правится ОДНОВРЕМЕННО
  с включением отправки кадров, в обеих версиях), тест сверяет честностные утверждения.
- Сознательно не переведён `vision/accuracyRun.ts` + роут `/accuracy` — DEV-инструмент гейта 0.3.

## Внешние сервисы / контракты
- **WS-протокол** дуэли описать в `docs/ws-protocol.md` (join, status_update, countdown, start, finish, opponent_left).
- **События честности** (клиент→сервер): `scramble_shown, scramble_verified, hands_ready, solve_start, solve_stop, cube_verified` — сервер ставит свои таймстампы.
- **Почта:** Resend/Brevo API (async background task).
- **Хранилище кадров:** S3-совместимое или папка (MVP), TTL 7 дней.
