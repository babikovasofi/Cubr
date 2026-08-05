# Build report: Скрамбл дня (slug: daily-scramble)

Status: **complete, tests green, migration live-applied.** The exec agents wrote
the code but hit the subagent session limit before the test/verify step; the
full backend test suite + verification + this report were finished inline.

## Decision B — parallel daily vertical (tournament untouched)
New `daily_*` tables / service / router / page mirroring the weekly tournament;
the shipped tournament vertical is byte-for-byte unchanged. Genuine reuse (no
fork): the pure helpers `now_utc` / `is_past_deadline` / `display_name_for` /
`ANONYMOUS_DISPLAY_NAME` are IMPORTED from `services.tournament`, and the entire
solo ritual (`SolveRitual` + `useSoloSession({fixedScramble,…})`) is reused as-is
on the frontend. `finalize.py` is the only shared file — additively extended to
sweep both verticals in one commit.

## Backend
- `models/daily.py` — `DailyChallenge` (`date` UNIQUE, event, scramble) +
  `DailyAttempt` (UNIQUE(user_id, daily_id), status/honesty/time_ms/started_at/
  submitted_at). `models/__init__` exports both; `conftest` registers their
  tables in `create_all`.
- `schemas/daily.py` — `DailyAttemptSubmit` (extra=forbid, no honesty),
  `DailyAttemptRead` (WITH scramble), `DailyCurrentRead` / `DailyBoardRead`
  (NO scramble, П8), `BoardEntry` (no rank).
- `services/daily.py` — `get_or_create_current_daily` / `get_or_create_daily_attempt`
  (begin_nested SAVEPOINT + IntegrityError-reselect), `get_current_daily_attempt`
  (read-only; today-scoped by `daily_id`, lazy-dnf via a FRESH transient
  `DailyAttempt` view — never `copy.copy`, never `session.add`),
  `sweep_expired_daily_attempts` (re-guarded bulk UPDATE), `get_current_daily_board`
  (valid entries `submitted_at ASC, id ASC`, `public_handle`/«Аноним» only).
- `routers/daily.py` — authed `GET /current` (no scramble), `GET /current/board`
  (rate-limited, de-ranked, no PII), `POST /current/attempt/start` (scramble
  revealed), `POST /current/attempt/submit` (404/409/forced-dnf; NO badge call).
- `migrations/versions/0009_daily.py` (`down_revision 0008_user_badges`) —
  **live-applied**: `alembic upgrade head` 0008→0009 ran clean against the local
  Postgres; `/daily/*` anon → 401 verified by curl against the running server.
- `jobs/finalize.py` — additively sweeps daily after the (unchanged) tournament
  sweep, one commit, summed return.
- `config.py` — `DAILY_ATTEMPT_WINDOW_SECONDS=600`, `DAILY_BOARD_LIMIT_DEFAULT/MAX`,
  `DAILY_RATE_LIMIT`.

Skeptic HIGH resolutions verified in code: parallel tables + imported helpers
(HIGH#1); fresh-view lazy dnf, no copy.copy (HIGH#2); separate additive sweep
(HIGH#3); today-`daily_id`-scoped read (HIGH#4); UTC single-column UNIQUE(date),
begin_nested, no-badge daily submit, config, conftest registration (MED).

## Frontend (clone of the tournament vertical, no fork)
`api/daily.ts`, `daily/{useDailyAttempt,useDailyBoard,DailyBoard,DailyResult}`,
`pages/DailyPage.tsx` (reuses the solo ritual via `useSoloSession`), `/daily`
route (ProtectedRoute) in `App.tsx`, and a «Скрамбл дня» card on `HomePage`.

## Tests + verification
- Backend `tests/test_daily.py` (13) — auth 401 (all 4 endpoints); first start
  creates challenge+attempt (started/pending/scramble, one challenge); idempotent
  start (same id+scramble, no new row); **П8** (no scramble on current/board;
  deadline_at = started_at + window); submit valid; 404 no-challenge / 404
  no-attempt / 409 terminal; **forced-dnf past deadline** (frozen day + advanced
  clock); board empty-day; board de-ranked valid entry («Аноним», is_self, no
  rank/email/nickname); **§П5** (daily flow writes zero solves, best_single_ms
  unchanged).
- Backend `tests/test_daily_finalize.py` (9) — sweep flips expired started→dnf,
  ignores fresh/valid/dnf, idempotent, empty→0; **cross-day rollover** (prior-day
  started swept, today's untouched); lazy-view normalization without mutating the
  row; **`finalize.run()` sweeps BOTH tournament + daily in one commit** (returns 2).
- Frontend `tests/daily/` (33, authored by the exec agent) — useDailyAttempt
  reducer, api client, DailyBoard.

Orchestrator-run verification:
- Backend: `pytest` **240 passed** (+22 daily); `ruff` clean; `mypy app` clean (51 files).
- Frontend: `vitest` **483 passed**; `tsc` clean; `eslint` clean.
- Migration 0009 applied to live Postgres; `/daily/*` endpoints answer on the
  running dev server.

## Open
- Two-account live click-through of `/daily` (start→ritual→submit→board, resume,
  forced-late-dnf) — needs camera + two users, same as the tournament brick.
- External cron must call `python -m app.jobs.finalize` (now sweeps daily too).
