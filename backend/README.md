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

## Scheduled finalize

The weekly tournament's expired `started` attempts (past `TOURNAMENT_ATTEMPT_WINDOW_SECONDS`
without a submit) are swept to `dnf` by a standalone job, not an in-process scheduler:

```bash
cd backend && uv run python -m app.jobs.finalize
```

Wire this to an **external** trigger — system cron, a container CronJob, or your platform's
scheduler — e.g. Monday-night per §П8 (the week has fully closed), or every N minutes for
tighter standings freshness:

```cron
# every 5 minutes
*/5 * * * * cd /path/to/backend && uv run python -m app.jobs.finalize >> /var/log/cubr-finalize.log 2>&1
```

**Why external, not in-process (FastAPI lifespan / APScheduler):** an in-process scheduler ties
the "cron" to a single web worker's lifetime — N web workers means N concurrent schedulers
double/triple-running the same job, and it stops running whenever that worker is down/scaling to
zero. An external trigger decouples *when* the job runs from the web process, and the job itself
is a plain idempotent command (`sweep_expired_attempts` re-guards `status == "started"` on its
UPDATE), so any number of overlapping/duplicate external invocations is harmless — no
distributed lock needed today.

Note this doesn't leave a gap: `GET /tournament/current` independently normalizes an expired
`started` attempt to `dnf` in its *response* the moment it's read (without writing the row), so
the caller never sees a live-looking expired attempt regardless of when the job last ran. The job
is what makes that `dnf` durable (and visible in `dnf_count` on the standings board).

**Advisory lock:** not needed yet — the sweep only ever flips `status`/`submitted_at` and does so
idempotently. Add a Postgres advisory lock (`pg_try_advisory_lock`) around the job's transaction
only once finalize grows a **non-idempotent** step (e.g. awarding cups/points once per week) that
must not run twice concurrently.

## Tests

```bash
uv run pytest
```

Health test uses a lightweight aiosqlite path — no real Postgres needed.
