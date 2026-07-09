# Cubr backend

FastAPI + async SQLAlchemy 2.0 + Postgres. Stage 2.1 scaffold (no auth yet — that's 2.2).

## Setup

```bash
cp .env.example .env          # fill values (defaults work with docker-compose)
docker-compose up -d          # local Postgres 16 (healthcheck + pgdata volume)
uv sync                       # install deps (Python 3.12)
uv run alembic upgrade head   # create `user` + `solves` tables
uv run uvicorn app.main:app --reload
```

- `GET /health` → `{"status":"ok","db":"ok"}` (pings DB with `SELECT 1`)
- `/docs` — OpenAPI UI

## Tests

```bash
uv run pytest
```

Health test uses a lightweight aiosqlite path — no real Postgres needed.
