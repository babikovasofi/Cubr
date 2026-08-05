# Plan: Скрамбл дня (daily-scramble)   (slug: daily-scramble)

## TL;DR
A daily (UTC-date) mini-challenge cloning the shipped weekly-tournament
attempt-lifecycle: one shared scramble per calendar day, one idempotent
get-or-create attempt per user, ~10-min submit deadline → forced dnf, de-ranked
participation board. Built as a **PARALLEL `daily_*` vertical** (new tables /
service / router / page) — **the shipped tournament vertical is byte-for-byte
untouched** — while REUSING (importing, not copying) the model-agnostic pure
helpers `now_utc` / `is_past_deadline` / `display_name_for` /
`ANONYMOUS_DISPLAY_NAME` and the entire solo ritual (`SolveRitual` +
`useSoloSession({fixedScramble,disableSoloSave,onResult})`, no fork). Invariants:
scramble only in the authed start/submit response (П8); honesty stays `pending`,
never gates; §П5 PB frozen — daily writes touch ONLY `daily_*` tables (zero
`Solve` / `User.best_single_ms` writes).

**Skeptic returned `revise` (4 HIGH); all resolved** by the planner's Decision B
+ these merge fixes. HIGH#1 reuse-vs-dup → parallel tables, import the pure
helpers (no edit to tournament functions). HIGH#2 `copy.copy` transient-view
landmine → the lazy-dnf read builds a FRESH `DailyAttempt(...)` view, never
`copy.copy`, never `session.add`. HIGH#3 stale prior-day `started` rows → a
SEPARATE `sweep_expired_daily_attempts` + an ADDITIVE second call in
`finalize.run()` (tournament sweep line untouched). HIGH#4 read must scope to
today's `daily_id` → `get_current_daily_attempt` selects today's challenge first
(→ `(None,None)` if absent), then the attempt WHERE `daily_id==today`, never by
`user_id` alone.

## Acceptance criteria
- `POST /daily/current/attempt/start` (authed; 401 anon) get-or-creates today's
  `DailyChallenge` (UTC date) + the caller's `DailyAttempt`, returns the scramble.
  Idempotent: a 2nd start the same UTC day → SAME attempt + SAME scramble (no
  re-roll, no new row), even after terminal.
- The scramble appears ONLY in the start/submit response (`DailyAttemptRead`).
  `GET /daily/current` and `/current/board` schemas carry NO `scramble` field (П8).
- `GET /daily/current` (authed) returns day metadata (date/day_label, event) +
  the caller's attempt_status/time_ms/started_at/submitted_at/deadline_at,
  creating NOTHING and starting no clock. A `started` attempt past its deadline
  reads back as `dnf` (lazy view — never mutates the row).
- `POST /daily/current/attempt/submit` records against the started attempt: 404
  no challenge/attempt today; 409 already terminal; submit past
  `started_at + DAILY_ATTEMPT_WINDOW_SECONDS` → forced `dnf` regardless of
  payload; honesty stays `pending`. NO badge evaluation is called.
- `GET /daily/current/board` (authed, rate-limited, read-only, no scramble) →
  `status=='valid'` finishers ordered `submitted_at ASC, id ASC` (clamped by
  DAILY_BOARD limits) + `valid_count`, `dnf_count`, `your_entry`; only
  `public_handle`/«Аноним» (never email/nickname); NO rank/position field.
- Rollover: a `started` attempt from a prior UTC day reads as dnf via
  `GET /daily/current`, and the finalize cron persists it to dnf. `finalize.run()`
  is idempotent and now sweeps BOTH tournament and daily in one commit.
- Frontend `/daily` (ProtectedRoute) renders the challenge reusing
  SolveRitual/useSoloSession with `fixedScramble` (no solo fork), mirroring
  TournamentPage phases (loading/precommit/resume/committing/active/submitting/
  terminal + 409/401/network recovery). A HomePage card links to `/daily`.
- `UNIQUE(date)` on `daily_challenges` and `UNIQUE(user_id, daily_id)` on
  `daily_attempts` hold under concurrent starts (SAVEPOINT + IntegrityError
  re-SELECT). Migration 0009 applies cleanly (`down_revision 0008_user_badges`).
- §П5 preserved; ruff/mypy(strict, scope)/tsc/lint clean; all backend + frontend
  tests green.

## Plan
Decision **B (parallel daily vertical)** — justification: tournament just shipped
(review ship) and the repo values not destabilizing live bricks; Option A
(generalize to a `period` dimension) would EDIT every shipped tournament file
(regression risk to a brick with users). Duplication is bounded and mechanical;
genuine reuse (pure helpers + the whole solo ritual) is taken where it's free.

### Backend
- **`models/daily.py`** (new) — `DailyChallenge` (id GUID PK; `date: Mapped[date]`
  `mapped_column(Date)`, `UNIQUE(date)` `uq_daily_challenges_date`; event
  String(16) default '333'; scramble String(512); created_at). `DailyAttempt`
  (id; user_id FK user.id CASCADE index; daily_id FK daily_challenges.id CASCADE
  index; status default 'started'; honesty default 'pending'; time_ms nullable;
  started_at server_default now(); submitted_at nullable;
  `UNIQUE(user_id, daily_id)` `uq_daily_attempts_user_daily`). Status/honesty
  tuples in the `models/tournament.py` style.
- **`models/__init__.py`** — export `DailyChallenge`, `DailyAttempt` (alphabetical).
- **`tests/conftest.py`** (merge fix — skeptic MED, was omitted) — import both +
  add `DailyChallenge.__table__`, `DailyAttempt.__table__` to the `create_all`
  tables list, else the tables don't exist under the sqlite test engine.
- **`schemas/daily.py`** (new) — `DailyAttemptSubmit` (`extra="forbid"`, time_ms
  gt=0, status Literal['valid','dnf']='valid'; NO honesty). `DailyAttemptRead`
  (from_attributes; id, daily_id, status, honesty, time_ms, started_at,
  submitted_at, date, day_label, event, **scramble**). `BoardEntry`
  (display_name, time_ms, is_self; NO rank). `DailyBoardRead` (date, day_label,
  event, entries, your_entry, valid_count, dnf_count). `DailyCurrentRead` (date,
  day_label, event, attempt_status, time_ms, started_at, submitted_at,
  deadline_at — **NO scramble**).
- **`services/daily.py`** (new) — `current_day(now=None) = (now or now_utc()).date()`
  (UTC). `day_label(d)=d.isoformat()`. **Import** `now_utc, is_past_deadline,
  display_name_for, ANONYMOUS_DISPLAY_NAME` from `app.services.tournament` (no
  re-impl). `get_or_create_current_daily` (SELECT by date; else `begin_nested`
  insert with `scramble=random_scramble()`; IntegrityError → re-SELECT).
  `get_or_create_daily_attempt` (same SAVEPOINT on user_id/daily_id).
  `get_current_daily_attempt` (read-only; **selects today's daily first, returns
  (None, None) if absent, then attempt scoped to that daily_id**; lazy-dnf via a
  transient **fresh `DailyAttempt(...)`** view — NEVER `copy.copy`, never
  `session.add`). `sweep_expired_daily_attempts` (SELECT `started` daily attempts,
  `is_past_deadline` filter, guarded bulk UPDATE `status='dnf'`,
  `submitted_at=now`, return rowcount). `get_current_daily_board`.
- **`routers/daily.py`** (new) — `APIRouter(prefix="/daily")`, `_ip_limit =
  Depends(ip_rate_limit(settings.DAILY_RATE_LIMIT))` on **start, submit, AND
  board** (skeptic LOW). `GET /current` (authed, no scramble). `GET /current/board`
  (authed, rate-limited, clamp DAILY_BOARD_LIMIT_MAX). `POST /current/attempt/start`
  (get_or_create daily+attempt, commit, refresh, return `DailyAttemptRead` WITH
  scramble). `POST /current/attempt/submit` (404/409/deadline-forced-dnf like
  tournament; **NO badge call**). П8/privacy docstrings.
- **`main.py`** — `include_router(daily.router)`.
- **`config.py`** — `DAILY_ATTEMPT_WINDOW_SECONDS=600`, `DAILY_BOARD_LIMIT_DEFAULT=50`,
  `DAILY_BOARD_LIMIT_MAX=200`, `DAILY_RATE_LIMIT="60/minute"`.
- **`migrations/versions/0009_daily.py`** (new) — revision `0009_daily`,
  `down_revision "0008_user_badges"`, hand-written (mirror 0005): `daily_challenges`
  (id UUID PK, `date` sa.Date NOT NULL, event, scramble, created_at) +
  `uq_daily_challenges_date`; `daily_attempts` (id, user_id, daily_id, status,
  honesty, time_ms, started_at, submitted_at) + user_id/daily_id indexes + CASCADE
  FKs + `uq_daily_attempts_user_daily`. Full downgrade.
- **`jobs/finalize.py`** (EXTEND, additive) — import `sweep_expired_daily_attempts`;
  in `run()` AFTER the existing tournament sweep and BEFORE the single commit,
  `swept_daily = await sweep_expired_daily_attempts(session, now_utc(),
  settings.DAILY_ATTEMPT_WINDOW_SECONDS)`; keep the tournament sweep call/line
  unchanged; expand the log line; keep the return type stable (return the SUM;
  update `test_tournament_finalize.py`'s return assertion ONLY if it checks the
  exact int — do not change tournament sweep semantics).

### Frontend
- **`api/daily.ts`** (new) — mirror `api/tournament.ts`: `DailyCurrentRead` (no
  scramble), `DailyAttemptRead` (with scramble, no new_badges), `DailyBoardEntry`,
  `DailyBoardRead`, `DailyAttemptSubmit`; `getCurrentDaily`, `getDailyBoard(limit?)`,
  `startDailyAttempt`, `submitDailyAttempt` against `/daily/*`.
- **`daily/useDailyAttempt.ts`** (new) — clone `useTournamentAttempt` reducer/state
  machine 1:1 (phases, 409-recover via GET /current, 401 unauthorized, network,
  forcedLateDnf); DROP the new_badges toast branch; `day_label` replaces
  `week_label`.
- **`daily/DailyResult.tsx`**, **`daily/DailyBoard.tsx`**, **`daily/useDailyBoard.ts`**
  (new) — clone TournamentResult / TournamentStandings / useTournamentStandings;
  «Скрамбл дня · {day_label}», «Кто уже собрал сегодня», quiet DNF, no rank.
- **`pages/DailyPage.tsx`** (new) — clone TournamentPage: Precommit/Resume/Error
  cards + ActiveRitual via `useSoloSession({fixedScramble,disableSoloSave,onResult})`
  (reuse ritual, no fork); countdown from `deadline_at`; renders DailyBoard.
- **`App.tsx`** — `/daily` route under ProtectedRoute.
- **`pages/HomePage.tsx`** — a `<Link to="/daily">` «Скрамбл дня» card mirroring
  the `/tournament` card.

## Test plan
Full coverage. haiku authors exactly these.

### Backend — `tests/test_daily.py` (mirror `test_tournament.py`)
- Auth gate: start/submit/current/board → 401 anon.
- First start → creates challenge+attempt, status `started`, scramble present,
  honesty `pending`; exactly one DailyChallenge for the date.
- Idempotent start: 2nd start → same attempt id + same scramble, no new row, works
  after terminal too.
- Concurrency: two `get_or_create_current_daily` / two `get_or_create_daily_attempt`
  racing → single row (drive IntegrityError-reselect; assert one challenge per
  date / one attempt per (user, daily)).
- `GET /daily/current`: NO scramble on the wire; attempt_status null pre-start;
  `deadline_at == started_at + window` after start; a `started` attempt with
  injected `now` past deadline reads `dnf` AND the persisted row is still
  `started` (lazy view didn't mutate — the copy.copy landmine test).
- submit: valid happy path (time_ms/status recorded); 404 no challenge/attempt;
  409 already terminal; submit past window (injected now) → forced `dnf` even with
  payload `valid`; **§П5**: zero `Solve` rows + `User.best_single_ms` unchanged
  after a full daily flow.
- board: empty day → `[]`, zero counts, your_entry null (not 404); order
  submitted_at ASC/id ASC; valid_count/dnf_count correct; your_entry present
  regardless of limit; limit clamped to MAX; display_name = public_handle/«Аноним»,
  response never contains email/nickname; no rank field; no scramble field.

### Backend — `tests/test_daily_finalize.py` (mirror `test_tournament_finalize.py`)
- `sweep_expired_daily_attempts` with injected now flips only past-deadline
  `started` → dnf + sets submitted_at; idempotent (2nd run sweeps 0); leaves
  valid/dnf untouched.
- `finalize.run()` sweeps BOTH tournament and daily in ONE commit (a stale daily
  started AND a stale tournament attempt both → dnf in one run); cross-day
  rollover: yesterday's started swept, today's untouched.

### Frontend
- `daily/useDailyAttempt.test.ts` — reducer transitions (loading → precommit /
  resume / terminal; 409-recovery; 401 unauthorized; network; forcedLateDnf).
- `api/daily.test.ts` — getCurrentDaily/getDailyBoard/start/submit hit the right
  `/daily/*` URLs + typed returns; start response type carries scramble, current
  does not.
- `daily/DailyBoard.test.tsx` — renders entries (no rank), «Аноним» fallback,
  empty-state, your-entry highlight.

## Blockers
None — the central decision (parallel tables + pure-helper import) resolves
skeptic HIGH#1; HIGH#2/3/4 pre-empted (fresh-view lazy read, separate additive
sweep, today-scoped read); MED/LOW (conftest registration, UTC single-column
UNIQUE(date), begin_nested, no-badge daily submit, DAILY_* config, rate-limit on
all three, board parity) baked in. Proceed to /build.

## Out of scope
- Editing/generalizing ANY tournament file (Decision B keeps them untouched).
- Badges for daily attempts (no registry/evaluator change; a `daily_debut` badge
  is a future add).
- Historical/archive views, streaks, ranking/rating, honesty verification
  (honesty stays plumbing-only `pending`).
- Any change to solo (SolveRitual/useSoloSession) — reused via fixedScramble.
- In-process scheduler for the daily sweep — reuse the external-cron finalize job.
- WCA random-STATE scrambles (random-MOVE, same MVP call as tournament).

## Assumptions
- Migration head is `0008_user_badges` → new is `0009`.
- No badges for daily: submit does NOT call the badge engine; `DailyAttemptRead`
  has no `new_badges`; `app.services.badges` untouched.
- `day_label` = ISO date string (YYYY-MM-DD); UI may format РУ-friendly, wire is ISO.
- Event fixed '333' (matches tournament); board authed-only (no public route, П8).
- `current_day` uses UTC (`now_utc().date()`), NOT local `date.today()`; tests
  inject `now` to freeze the boundary.
