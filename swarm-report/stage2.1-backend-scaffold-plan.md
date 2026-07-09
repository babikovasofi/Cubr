# Plan: Этап 2.1 — каркас бэкенда   (slug: stage2.1-backend-scaffold)

## TL;DR
Гринфилд `backend/`: FastAPI + async SQLAlchemy 2.0 к локальному Postgres (docker-compose),
alembic **async** env, модели `users`+`solves`, CORS (explicit origins + credentials),
конфиг pydantic-settings из `.env`, `GET /health` с `SELECT 1`. Без авторизации (это 2.2),
но **User наследует базу fastapi-users уже сейчас** — чтобы 2.2 не переписывал таблицу.

## Acceptance criteria (observable; /review проверяет)
1. `docker-compose up -d` поднимает postgres:16 с healthcheck (`pg_isready`) + volume `pgdata`.
2. `uv sync` ставит зависимости (Python 3.12); `uvicorn app.main:app` стартует без ошибок.
3. `alembic upgrade head` создаёт таблицы `user` + `solves`; `alembic downgrade base` откатывает.
4. `GET /health` → 200 `{"status":"ok","db":"ok"}` — реально пингует БД `SELECT 1`.
5. `/docs` (OpenAPI) открывается с health-роутером.
6. CORS: explicit origins из `CORS_ORIGINS` (Vite `http://localhost:5173` + `127.0.0.1:5173`),
   `allow_credentials=True`, **без wildcard**.
7. Настройки из `backend/.env` (pydantic-settings v2); секретов в коде нет; `backend/.env.example` закоммичен.
8. `pytest` зелёный (health-тест без реального Postgres — aiosqlite/облегчённый путь).

## Plan (merged: planner + skeptic HIGH/MED/LOW)

### Структура + тулчейн
- **`backend/pyproject.toml`** — `requires-python=">=3.12"`. Deps: fastapi, uvicorn[standard],
  sqlalchemy[asyncio]>=2, asyncpg, alembic, pydantic-settings, **fastapi-users[sqlalchemy]**
  (нужен уже в 2.1 для базовой User-таблицы — skeptic HIGH). Dev: pytest, pytest-asyncio, httpx,
  aiosqlite. **[skeptic LOW]** зафиксировать **uv** (не poetry), закоммитить `uv.lock`.
- **`backend/.python-version`** = `3.12`.
- **`backend/README.md`** — команды: `docker-compose up -d`, `uv sync`, `alembic upgrade head`,
  `uvicorn app.main:app --reload`.
- **`backend/.env.example`** — `DATABASE_URL=postgresql+asyncpg://cubr:cubr@localhost:5432/cubr`,
  `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`, `APP_ENV=local`, `SECRET=<placeholder-2.2>`.
- **`backend/.gitignore`** — `.env`, `__pycache__`, `.venv`, `*.egg-info`, `.pytest_cache`.
- **`backend/docker-compose.yml`** — **[skeptic MED]** postgres:16, env cubr/cubr/cubr, `5432:5432`,
  volume `pgdata`, `healthcheck: pg_isready -U cubr`.

### App
- **`backend/app/config.py`** — **[skeptic MED]** `from pydantic_settings import BaseSettings,
  SettingsConfigDict`; один `DATABASE_URL` (не сборка из кусков); `cors_origins:list`; `SECRET`;
  `model_config=SettingsConfigDict(env_file=".env", extra="ignore")`; `get_settings()` + `lru_cache`.
- **`backend/app/db.py`** — `create_async_engine(settings.DATABASE_URL)`, `async_sessionmaker(
  expire_on_commit=False)`, `Base=DeclarativeBase`, `get_session()` async-генератор для Depends.
- **`backend/app/models/user.py`** — **[skeptic HIGH]** `class User(SQLAlchemyBaseUserTableUUID, Base)`:
  UUID PK, table `user`, `email`/`hashed_password`/`is_active`/`is_superuser`/`is_verified` от базы.
  Сверху app-колонки: `nickname`, `avatar_url(nullable)`, `cups(int default 0)`, `best_single_ms(nullable)`,
  `best_ao5_ms(nullable)`, `created_at(timestamptz server_default now())`. Google OAuth-таблица
  (`oauth_accounts`) — аддитивна, оставить на 2.2.
- **`backend/app/models/solve.py`** — `Solve(Base)` table `solves`: `id(UUID pk)`, `user_id(FK user.id,
  UUID, index)`, `duel_id(UUID nullable, БЕЗ FK)`, `tournament_id(UUID nullable, БЕЗ FK)` **[skeptic
  risk: FK на несуществующие таблицы — обычные UUID-колонки, FK добавим в 3.x/5.x]**, `scramble(str)`,
  `time_ms(int)`, **[skeptic LOW]** `status(VARCHAR + app-валидация valid|dnf|rejected, НЕ DB-enum)`,
  `verify_frames_ok(bool default false)`, `created_at(timestamptz server_default now())`.
- **`backend/app/models/__init__.py`** — реэкспорт `User`, `Solve` (alembic видит metadata).
- **`backend/app/schemas/health.py`** — `HealthOut(BaseModel)`: `status:str`, `db:str`.
- **`backend/app/routers/health.py`** — `APIRouter(tags=["health"])`; `GET /health` делает
  `SELECT 1` через сессию (**skeptic LOW: доказать проводку БД, не пустой ok**), возвращает HealthOut.
- **`backend/app/main.py`** — app, `CORSMiddleware(allow_origins=settings.cors_origins,
  allow_credentials=True, methods, headers)` **[skeptic MED]**, `include_router(health)`, title="Cubr API".
- **`backend/app/services/__init__.py`** — **[skeptic LOW: не оверскаффолдить]** пустой пакет-задел,
  без файлов-заглушек.

### Alembic (async)
- **`backend/alembic.ini`** — `script_location=migrations`; `sqlalchemy.url` НЕ хардкодить.
- **`backend/migrations/env.py`** — **[skeptic HIGH]** async-режим: `AsyncEngine`, миграции через
  `connection.run_sync(do_run_migrations)` в `asyncio.run`; `target_metadata=Base.metadata`; явный
  импорт `app.models` (User+Solve) чтобы autogenerate их видел; url из `settings.DATABASE_URL`.
- **`backend/migrations/script.py.mako`** — стандартный шаблон.
- **`backend/migrations/versions/0001_init.py`** — autogenerate → **вычитать руками** → create
  `user` + `solves` + индексы/уник. `upgrade head` проверить `\dt`.

### Tests
- **`backend/tests/conftest.py`** — `httpx.AsyncClient(ASGITransport)` фикстура; тестовая БД
  aiosqlite in-memory ИЛИ health-путь без реального Postgres **[skeptic MED risk: не завязывать CI
  на docker; asyncpg-специфику (UUID/timestamptz) на sqlite не гонять]**.
- **`backend/tests/test_health.py`** — `GET /health` → 200, `body.status=="ok"`.

### Docs
- `docs/decisions.md` (создать если нет) — строки: «async SQLAlchemy+asyncpg+alembic async env»,
  «UUID PK», «status как VARCHAR не DB-enum», «пакетник uv», «User наследует fastapi-users base в 2.1».

## Blockers
Нет решений за пользователя. **Пререквизит окружения (для `/build`, не для плана):** в системе нет
`uv`/`poetry`/python3.12 — build поставит `uv` (`curl -LsSf https://astral.sh/uv/install.sh`) +
python 3.12. Docker нужен для ручной проверки миграций (тесты идут без него).

## Out of scope
- Любая авторизация: fastapi-users роутеры/JWT/argon2/OAuth/письма (2.2) — берём только базовую User-таблицу.
- `oauth_accounts`, модели `duels`/`tournaments`/`attempts`/`trophy_log`.
- WebSockets, ConnectionManager, серверная CV/OpenCV, APScheduler.
- Эндпоинты кроме `/health` (`POST /solves` — 2.3).
- Прод-деплой, Railway/Render, Dockerfile бэкенда (только docker-compose для локального Postgres).
- Реальные FK-констрейнты на `duel_id`/`tournament_id`.

## Assumptions
- `id`=UUID (data-model не уточняет; фиксируем UUID — совместимо с fastapi-users/OAuth).
- `password_hash`→`hashed_password` (нейминг fastapi-users); `google_id` inline убран (OAuth-таблица в 2.2).
- Пакетник — **uv** (development-conventions «uv (или poetry)»). Vite dev-порт 5173 для CORS.
- `/health` пингует БД; тест использует облегчённый путь без реального коннекта.
- Модели `duels`/`tournaments`/`attempts`/`trophy_log` в 2.1 НЕ создаём — только `user`+`solves`.
