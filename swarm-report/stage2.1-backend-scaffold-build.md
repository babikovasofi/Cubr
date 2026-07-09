# Build: Этап 2.1 — каркас бэкенда   (slug: stage2.1-backend-scaffold)

Plan: [stage2.1-backend-scaffold-plan.md](stage2.1-backend-scaffold-plan.md). Agent: `python-fastapi` (гринфилд `backend/`).

Окружение поставлено оркестратором: `uv` 0.11.28 + CPython 3.12.13 (в `~/.local/bin`).

## Changed files (все под `backend/`, + `docs/`)
- Тулчейн: `pyproject.toml`, `.python-version`, `.gitignore`, `.env.example`, `README.md`,
  `docker-compose.yml`, `uv.lock`
- App: `app/{__init__,config,db,main}.py`
- Модели: `app/models/{__init__,user,solve}.py`
- Схемы: `app/schemas/{__init__,health}.py`
- Роутеры: `app/routers/{__init__,health}.py`
- `app/services/__init__.py` (пустой пакет-задел)
- Alembic: `alembic.ini`, `migrations/{env.py,script.py.mako}`, `migrations/versions/0001_init.py`
- Тесты: `tests/{__init__,conftest,test_health}.py`
- `docs/decisions.md` (журнал решений)

## API
`GET /health` → 200 `{"status":"ok","db":"ok"}` (реальный `SELECT 1`); OpenAPI `/docs`.
Auth-эндпоинтов нет (2.2). CORS из `CORS_ORIGINS`, `allow_credentials=True`, без wildcard.

## Skeptic-констрейнты — все соблюдены
- `User(SQLAlchemyBaseUserTableUUID, Base)` + app-колонки (nickname/avatar_url/cups/best_*/created_at).
- `solves.user_id` FK→`user.id` (UUID); `duel_id`/`tournament_id` — nullable UUID БЕЗ FK.
- `status` = VARCHAR + `SOLVE_STATUSES` app-валидация (не DB-enum).
- Alembic **async** env.py: `AsyncEngine` + `run_sync` в `asyncio.run`, `target_metadata=Base.metadata`, импорт `app.models`.
- pydantic-settings v2: один `DATABASE_URL`, `SettingsConfigDict(extra="ignore")`, `get_settings()`+`lru_cache`.
- docker-compose postgres:16 + healthcheck `pg_isready` + volume `pgdata`.
- `services/` пустой (без оверскаффолда). `uv.lock` закоммичен.

## Tests (проверено дважды: агент + main)
```
uv run pytest -q      → 1 passed in 0.01s   (health, aiosqlite in-memory через dependency_overrides)
ruff check .          → All checks passed!
ruff format --check   → clean
mypy app              → Success: no issues found in 12 source files
```

## Миграция
- `uv run alembic upgrade head --sql` (offline) — корректный DDL: `"user"` (+ unique `ix_user_email`),
  `solves` (+ `ix_solves_user_id`, FK→user.id ON DELETE CASCADE). `downgrade --sql 0001_init:base` чисто дропает.
- `0001_init` — **hand-written** (autogenerate требует живую БД), точно отражает ORM-metadata.

## Осталось (manual — нет Docker в этом окружении)
`docker`/`docker-compose` не установлены → **живая миграция не прогонялась**. Твой ручной шаг:
```
cd backend && docker-compose up -d
uv run alembic upgrade head     # \dt → user, solves
uv run alembic downgrade base   # откат
uv run uvicorn app.main:app --reload   # /health, /docs живьём
```
