# Build: weekly tournament finalize (production)

Plan: [finalize-cron-plan.md](finalize-cron-plan.md). Production design: idempotent sweep + standalone CLI job (external-cron triggered) + lazy-read. Backend-only (python-fastapi/sonnet), tests on **haiku**. NO dependency, NO migration, NO lifespan, NO column.

## Changed (backend/)
- `app/services/tournament.py`:
  - `sweep_expired_attempts(session, now, window_seconds) -> int` — pure, no commit; SELECT started+tournament, collect ids where `is_past_deadline(attempt, now, window)`, single bulk `UPDATE ... WHERE id IN(...) AND status=="started" SET status="dnf", submitted_at=now`; return rowcount. Guard `status=="started"` → idempotent + concurrency-safe (2nd runner / mid-submit commit matches 0 rows). (mypy: `cast("CursorResult[Any]", ...)` for `.rowcount`.)
  - `get_current_attempt` — optional `window_seconds` (default settings); an expired `started` attempt is reported `"dnf"` in the RETURNED view via `copy.copy(attempt)` — never mutates the ORM row (read stays read-only). `GET /tournament/current` reflects it automatically.
- `app/jobs/__init__.py` NEW + `app/jobs/finalize.py` NEW — `async def run() -> int` (open session via `async_session_maker`, sweep with `now_utc()` + window, commit, log `finalize: swept {n} expired attempts`, return n); `python -m app.jobs.finalize` entrypoint.
- `app/routers/tournament.py` — no change (already builds from get_current_attempt).
- `README.md` — "Scheduled finalize" section: external cron example (`uv run python -m app.jobs.finalize`), why external not in-process APScheduler, lazy-read means no correctness gap between runs, advisory lock only for future non-idempotent finalize.

## Why this shape
External scheduler → decoupled idempotent CLI job (grown-up), NOT in-process APScheduler (fragile, dies with worker, multi-worker double-run). Reads made correct independently (lazy-read). Same command later serves cups/rollover; trigger can grow cron→queue without touching logic.

## Tests (haiku authored + ran) — `tests/test_tournament_finalize.py` (+10)
sweep: flips-expired→dnf, ignores-not-yet-expired, ignores-valid+dnf, sets-submitted_at, idempotent, empty-db-0, mixed-batch-counts-only-expired. job: `run()` sweeps+commits (fresh-session readback). view: get_current_attempt normalizes expired started→dnf (DB row stays started). board: dnf_count correct after sweep+commit.

## Verification (real)
```
LIVE: uv run python -m app.jobs.finalize (local Postgres @ head) → "swept 0"; synthetic expired started inserted via psql → "swept 1" (row dnf + submitted_at); rerun → "swept 0" (idempotent); DB restored.
uv run pytest -q → 112 passed
uv run ruff check → All checks passed
uv run mypy app → Success, 35 files
```

## Deferred
Deployment cron wiring (documented, provision per hosting — Monday-night §П8 / every N min); advisory lock (only when non-idempotent finalize lands); cups/points/past-week board.
