# Plan: weekly tournament finalize (production)   (slug: finalize-cron)

Decision: **production-correct design** — idempotent sweep + standalone CLI job (triggered by an
EXTERNAL scheduler) + lazy-read correctness. NOT in-process APScheduler (fragile, dies with the
worker, multi-worker double-run — the hackathon shape). No new dependency, no migration, no lifespan
coupling. Backend-only.

## Why this shape (vs the two earlier options)
- In-process APScheduler ties a scheduler to each web worker → N workers = N concurrent runs, and the
  "cron" only runs while a web worker is up. Grown-up scheduling = an EXTERNAL trigger (system cron /
  container CronJob / platform scheduler) invoking a decoupled, idempotent job command.
- The job LOGIC (what to finalize) is decoupled from the TRIGGER (how/when it runs). Same command later
  serves cups/points/rollover; the trigger can grow from a simple cron to a queue without touching logic.
- Reads are made correct independently (lazy-read), so behavior is right even between runs / before any
  scheduler is wired.

## TL;DR
`sweep_expired_attempts(session, now, window)` flips every expired `started` tournament attempt to `dnf`
(idempotent, injected clock). A standalone `python -m app.jobs.finalize` opens a session, runs the sweep,
commits — the artifact an external cron calls. `get_current_attempt` additionally normalizes an expired
`started` to `dnf` in its returned view so `GET /tournament/current` is correct immediately. Finalization
of a past week is derived (`(iso_year,iso_week) < current`) — no flag, no migration.

## Acceptance criteria
- `sweep_expired_attempts(session, now, window)` flips `status=="started" AND is_past_deadline(...)` →
  `dnf`, sets `submitted_at=now`, returns the count; does NOT touch not-yet-expired `started`, `valid`, or
  `dnf`; idempotent (2nd call → 0); empty DB → 0, no error. No commit (caller owns the transaction).
- `python -m app.jobs.finalize` runs the sweep against the real DB (opens a session via
  `async_session_maker`, uses `now_utc()`, commits, logs the count, exits 0). Safe to run at any frequency /
  overlapping (idempotent). Returns/logs how many were finalized.
- `get_current_attempt` returns an effective `dnf` (view-level) for a caller whose own attempt is `started`
  past its deadline, so `GET /tournament/current` never shows a live-looking expired attempt. Read-only
  (does not itself write); the persist is the job's responsibility.
- After the job runs, current-week expired `started` rows are `dnf` in the DB → they appear in the board's
  `dnf_count` (and stay out of valid entries). No board/standings code change.
- No new DB column, no migration, no new runtime dependency, no FastAPI lifespan scheduler.
- README/docs: how to wire an external scheduler to the command (Monday-night per §П8, or every N minutes),
  and a note that an advisory lock is only needed once finalize gains a NON-idempotent step (cups/points).
- backend pytest + ruff + mypy green.

## Plan — files
- `backend/app/services/tournament.py`:
  - `sweep_expired_attempts(session, now, window_seconds) -> int` — SELECT `started` attempts joined to
    their tournament; collect ids where `is_past_deadline(attempt, now, window_seconds)` (reuse the tested
    helper — handles sqlite-naive vs PG-aware datetimes); single bulk
    `update(TournamentAttempt).where(id.in_(ids), status=="started").values(status="dnf", submitted_at=now)`;
    return `rowcount`; no commit. The `status=="started"` guard makes it safe under concurrent runs + a
    mid-submit commit (second runner matches 0 rows).
  - In `get_current_attempt`: when the viewer's attempt is `status=="started"` and
    `is_past_deadline(attempt, now_utc(), TOURNAMENT_ATTEMPT_WINDOW_SECONDS)`, report its status as `"dnf"`
    in the returned view object (do not mutate the row here — keep the read read-only).
- `backend/app/jobs/__init__.py` NEW (package) + `backend/app/jobs/finalize.py` NEW:
  - `async def run() -> int`: `async with async_session_maker() as session:` → `n =
    await sweep_expired_attempts(session, now_utc(), settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS)` →
    `await session.commit()` → log `f"finalize: swept {n} expired attempts"` → return n.
  - `if __name__ == "__main__": asyncio.run(run())` so `python -m app.jobs.finalize` works.
- `backend/app/routers/tournament.py`: `GET /tournament/current` view already builds from
  `get_current_attempt`, so it reflects the normalized status automatically — verify, minimal/no change.
- `backend/README.md` (or docs/): a short "Scheduled finalize" section — external cron example calling
  `uv run python -m app.jobs.finalize`; rationale (external, not in-process); advisory-lock note for future
  non-idempotent finalize.
- `backend/tests/test_tournament_finalize.py` NEW — the Test plan below.

## Test plan (mandatory — haiku authors)
`backend/tests/test_tournament_finalize.py`:
- `test_sweep_flips_expired_started_to_dnf` — current-week `started`, `started_at = now-601s`, window 600 →
  sweep(now,600) returns 1; row `dnf`, `submitted_at == now`.
- `test_sweep_ignores_not_yet_expired` — `started_at = now-60s` → returns 0; stays `started`, `submitted_at` None.
- `test_sweep_ignores_valid_and_dnf` — a `valid` + a `dnf` (both stale) → returns 0; neither mutated.
- `test_sweep_sets_submitted_at_to_now` — swept row's `submitted_at` == injected now (normalized).
- `test_sweep_idempotent` — expired started → 1 then commit; 2nd sweep same now → 0, row unchanged.
- `test_sweep_empty_db_returns_zero` — no attempts → 0, no error.
- `test_sweep_mixed_batch_counts_only_expired` — expired-started + fresh-started + valid + dnf → returns 1
  (only the expired started); assert exactly that one is `dnf`, others untouched.
- `test_finalize_run_sweeps_and_commits` — insert an expired started; `await run()` (with async_session_maker
  pointed at the test engine / monkeypatched); returns 1; the row is `dnf` when read back in a FRESH session
  (proves commit).
- `test_get_current_attempt_normalizes_expired_started_to_dnf` — caller has a `started` attempt past its
  deadline; `get_current_attempt`/`GET /tournament/current` reports `attempt_status == "dnf"` (view-level),
  while the DB row is untouched by the read (still `started` until the job runs).
- `test_standings_dnf_count_after_sweep` — an expired started attempt: before sweep it's in neither entries
  nor dnf_count; after `sweep`+commit it's in `dnf_count`, still absent from valid entries.

## Blockers
None — production design chosen (external-cron + CLI + lazy-read).

## Out of scope
In-process APScheduler / lifespan scheduler; `is_finalized` column / migration 0007; past-week/historical
board endpoints; cups/points/ranking (honesty brick); honesty verification (sweep touches only status +
submitted_at, never honesty); advisory lock (documented as needed only for future non-idempotent finalize);
the actual deployment cron wiring (documented, not provisioned here); solves/PB (frozen П5).

## Assumptions
- Single rule: `is_past_deadline(attempt, now, TOURNAMENT_ATTEMPT_WINDOW_SECONDS)` (started_at+window<now),
  the same rule the submit route uses. Injected `now`/`window` — never inline `datetime.now()`.
- Idempotent job → external scheduler can call it at any cadence / overlapping without harm; a single
  external cron invocation means no multi-worker double-run in practice.
- Past-week finalization is derived, not stored. Backend-only; no frontend change.
