# Build: tournament-attempt

Plan: [tournament-attempt-plan.md](tournament-attempt-plan.md). Backend-only (python-fastapi, sonnet). Absorbs the folded weekly-tournament foundation.

## Changed (backend/)
- `app/models/tournament.py` NEW — `Tournament` (GUID pk, iso_year/iso_week Int, event, scramble String(512), created_at; UNIQUE iso_year,iso_week) + `TournamentAttempt` (GUID pk; user_id/tournament_id FK CASCADE; status "started"; **honesty server_default "pending"**; time_ms nullable; started_at/submitted_at; UNIQUE user_id,tournament_id). Registered in `models/__init__.py`.
- `app/schemas/tournament.py` NEW — `TournamentAttemptSubmit` (extra="forbid", time_ms gt=0, status Literal[valid,dnf]; honesty NOT accepted) + `TournamentAttemptRead` (scramble only here).
- `app/services/tournament.py` NEW — `now_utc`, `current_iso_week` (UTC isocalendar), `week_label` (zero-pad), `get_or_create_current_tournament`, `get_or_create_attempt` (each `begin_nested()` SAVEPOINT + IntegrityError re-select), `is_past_deadline`.
- `app/routers/tournament.py` NEW — `POST /tournament/current/attempt/{start,submit}`, both `current_active_user`-gated. Module-qualified `tournament_service.now_utc` so tests can monkeypatch (matches auth/email convention). start idempotent (200, same attempt+scramble); submit: 404 no tournament/attempt, 409 terminal, forced dnf past deadline.
- `app/config.py` — `TOURNAMENT_ATTEMPT_WINDOW_SECONDS=600`, `TOURNAMENT_RATE_LIMIT="60/minute"`. `app/main.py` — router included.
- `migrations/versions/0005_tournaments.py` NEW — hand-written, down_revision `0004_scrambles`, both tables + UNIQUE + FK CASCADE + indexes.
- `tests/conftest.py` — both tables in sqlite create_all. `tests/test_tournament.py` NEW — 21 tests.

## Skeptic HIGHs — all applied
- HIGH#1 abandon→DNF = deadline-based only (late submit forced dnf); leftover started → future finalize-cron (out of scope); no realtime-abandon claim.
- HIGH#2 plumbing not anti-cheat: honesty="pending" on every attempt from day 1; no standings read pending as trusted.
- HIGH#3 separate `tournament_attempts` table; `solves`/best_single_ms/GET /solves untouched (frozen PB invariant).
- MED savepoints per insert; submit state-machine 404/409 guards.

## Two real bugs caught pre-ship
1. mypy: reused `result` var across two `select()`s mistyped `attempt` as `Tournament` → renamed `tournament_result`/`attempt_result`.
2. sqlite returns NAIVE datetime for `DateTime(tz=True)` after flush (PG returns aware) → `is_past_deadline` normalizes both to UTC before compare (avoids TypeError on late-submit path).

## Tests (real)
```
uv run pytest tests/test_tournament.py -q → 21 passed
uv run pytest -q (full)                  → 86 passed
ruff check (scope)                       → All checks passed!
ruff format --check                      → 3 files reformatted, clean after
mypy (scope app+test)                    → Success (7 / 9 source files)
```
Coverage: ISO edges (2026 53-week, 2020/2021 + 2029/2030 crossovers, zero-pad labels), forced-dnf late-submit (frozen clock), 401/404/409 gates, idempotent start, two-users-one-tournament, begin_nested SAVEPOINT isolation, route-check (no public scramble leak).
Note: repo-wide `mypy .` = 11 = 9 pre-existing baseline + 2 same-pattern conftest list-item quirks (not new class).

## Deferred / live-only
- `alembic upgrade head` for 0005 against Postgres (no Docker) — same caveat as 0004.
- finalize-cron sweeping leftover started→dnf; frontend tournament UI; honesty verification brick.
