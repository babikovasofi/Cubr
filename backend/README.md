# Cubr backend

FastAPI + async SQLAlchemy 2.0 + Postgres. Auth via fastapi-users (Stage 2.2), solves API (2.3).

## Setup

```bash
cp .env.example .env          # fill values (SECRET/RESET_VERIFY_SECRET must be real — see below)
docker-compose up -d          # local Postgres 16 (healthcheck + pgdata volume)
uv sync                       # install deps (Python 3.12)
uv run alembic upgrade head   # create tables (user, oauth_account, solves)
uv run python -m app.seed     # OPTIONAL: create ready-made test accounts (local only)
uv run uvicorn app.main:app --reload
```

Secrets fail closed: `SECRET` and `RESET_VERIFY_SECRET` must be ≥32 chars and NOT contain a
placeholder fragment (`change-me`, …) in ANY env. Generate:
`python -c "import secrets; print(secrets.token_urlsafe(48))"`.

- `GET /health` → `{"status":"ok","db":"ok"}` (pings DB with `SELECT 1`)
- `/docs` — OpenAPI UI

## Test accounts (dev seed)

`uv run python -m app.seed` creates ready-made **verified** accounts so you can log in without
registering. Idempotent (re-run is a no-op) and **refuses to run unless `APP_ENV=local`** — there
is no auth bypass, just pre-made users. First account comes with a little solve history.

| Email | Password | Notes |
|---|---|---|
| `test@example.com` | `cubr-test-pw-123` | verified, has solve history + best-single |
| `alice@example.com` | `cubr-test-pw-123` | verified |

Log in via the app (which proxies `/api` to this backend).

## Tests

```bash
uv run pytest
```

Health test uses a lightweight aiosqlite path — no real Postgres needed.
