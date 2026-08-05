# Plan: tournament attempt lifecycle   (slug: tournament-attempt)

Этап 5, П8. Absorbs the folded weekly-tournament foundation. **Backend-only brick.**
Planner + skeptic converged; 3 HIGH applied below. No unresolved blockers.

## TL;DR
Authed `POST /tournament/current/attempt/start` gets-or-creates the current ISO-week tournament
(one shared weekly scramble, generated once) + the caller's one attempt (UNIQUE(user_id, tournament_id)),
and reveals the scramble ONLY in this authed response (П8 — never a public GET). `POST
/tournament/current/attempt/submit` records {time_ms, status valid|dnf} against the started attempt.
This brick is **plumbing, not anti-cheat**: time_ms is self-reported, every attempt records
`honesty="pending"`, and NO future standings may treat pending as trusted until the honesty brick lands.

## Acceptance criteria
- Anonymous start/submit → 401 (both require `current_active_user`).
- First authed start: creates a `tournaments` row for `datetime.now(timezone.utc).isocalendar()[:2]`
  (one `random_scramble()`), creates a `tournament_attempts` row (status "started", honesty "pending"),
  returns scramble + `week_label` "YYYY-Www" (zero-padded).
- Second start, same user same week → SAME attempt, SAME scramble, no new row, no re-roll (reload path).
- Two users same week → ONE tournaments row / identical scramble, TWO attempt rows (UNIQUE holds).
- Duplicate (iso_year,iso_week) and duplicate (user_id,tournament_id) races → IntegrityError caught via
  **per-insert SAVEPOINT** (`begin_nested`), re-SELECT winner, never 500, never lose the sibling insert.
- Submit {time_ms>0, status valid|dnf} on a started attempt → sets time_ms, status, submitted_at.
- Submit with no started attempt this week → **404**. Submit on already-terminal (valid|dnf) → **409**.
- Submit after `started_at + TOURNAMENT_ATTEMPT_WINDOW_SECONDS` → forced status "dnf" regardless of payload.
- **No route in this brick returns the weekly scramble to an anonymous / non-attempt caller** (П8).
- `honesty` on every attempt defaults "pending" server-side; client cannot set it (extra="forbid").
- `solves` table + best_single_ms + GET /solves UNTOUCHED (frozen П5 PB invariant — HIGH#3).
- backend pytest green (new test_tournament.py + full suite); ruff/mypy clean.

## Plan (backend/)
- **models/tournament.py** NEW — `Tournament` (portable GUID pk, iso_year Int, iso_week Int, event
  String(16) default/server_default "333", scramble String(512), created_at) + UniqueConstraint(iso_year,
  iso_week). `TournamentAttempt` (GUID pk; user_id GUID FK user.id CASCADE index; tournament_id GUID FK
  tournaments.id CASCADE index; status String(16) default/server_default "started"; **honesty String(16)
  default/server_default "pending"** (mirror П5 axis — HIGH#2); time_ms Int nullable; started_at
  DateTime(tz) server_default now(); submitted_at DateTime(tz) nullable) + UniqueConstraint(user_id,
  tournament_id). Tuples `TOURNAMENT_ATTEMPT_STATUSES=("started","valid","dnf")`, honesty per §П5.
  Register in models/__init__.py.
- **schemas/tournament.py** NEW — `TournamentAttemptSubmit(extra="forbid")`: time_ms int gt=0,
  status Literal["valid","dnf"]="valid" (Literal excludes server-only states; honesty NOT accepted).
  `TournamentAttemptRead(from_attributes)`: id, tournament_id, status, honesty, time_ms|None, started_at,
  submitted_at|None, iso_year, iso_week, week_label, event, scramble — scramble populated ONLY here.
- **services/tournament.py** NEW — single `current_iso_week(now=None)->(y,w)` on UTC isocalendar()[:2];
  `week_label(y,w)->f"{y:04d}-W{w:02d}"`; `get_or_create_current_tournament(session)` and
  `get_or_create_attempt(session,user_id,tournament_id)` — each SELECT-then-insert wrapped in
  `session.begin_nested()`; on IntegrityError the savepoint rolls back (NOT the whole session — HIGH#3/MED),
  re-SELECT. `is_past_deadline(attempt, now)`. Centralize `now()` for testability.
- **routers/tournament.py** NEW — `prefix="/tournament"`, both endpoints `Depends(current_active_user)`.
  start: get-or-create tournament → get-or-create attempt → commit → TournamentAttemptRead (always 200,
  returns current attempt state incl. terminal, + shared scramble). submit: load current-week tournament
  (SELECT, NO create) → 404 if none; load user attempt → 404 if none; 409 if status != "started";
  if is_past_deadline → force "dnf"; else status=payload.status, time_ms=payload.time_ms; submitted_at=now;
  commit. Rate-limit dep mirroring scramble router.
- **config.py** — `TOURNAMENT_ATTEMPT_WINDOW_SECONDS: int = 600`, `TOURNAMENT_RATE_LIMIT: str = "60/minute"`.
- **main.py** — include tournament router.
- **migrations/versions/0005_tournaments.py** NEW — down_revision "0004_scrambles"; hand-written, mirror
  0004 style; both tables + both UNIQUE constraints + FK CASCADE + indexes; downgrade drops both. Header:
  verify `alembic upgrade head` on Postgres before deploy. `solves.tournament_id` stays plain nullable UUID (untouched).
- **tests/conftest.py** — add Tournament/TournamentAttempt `__table__` to the sqlite create_all list.
- **tests/test_tournament.py** NEW — see Tests.

## Tests
Anon start/submit → 401. First start → 200 started+pending+scramble+week_label, one tournament+one attempt
row. Idempotent start → same attempt id + scramble. Two users → one tournament, two attempts, identical
scramble. Service: get_or_create_current_tournament twice → same id; duplicate (iso_year,iso_week) insert →
IntegrityError. ISO-week edges (frozen clock): 2026 53-week year, Dec-31/Jan-01 crossover (iso_year≠calendar),
week_label zero-pad "2020-W53"/"2026-W05". Submit valid → status valid+time_ms+submitted_at. Submit dnf.
Submit no prior start → 404. Submit twice → 409. Late submit (clock past deadline) → forced dnf. Route-check:
no public route returns the scramble.

## Blockers
None. All skeptic HIGH/MED applied.

## Out of scope
Public GET /tournament/current metadata (must NEVER return scramble); leaderboard/results/cup; finalize-cron
sweeping leftover started→dnf (П8.4); frame/OpenCV/timing honesty (attempts carry honesty=pending, gated
later); realtime WS abandon-detection (Этап 4); solves.tournament_id FK; mirroring attempts into solves;
frontend tournament UI; WCA random-STATE.

## Assumptions
- Separate tournament_attempts table (NOT solves) — one-per-week UNIQUE + started lifecycle + DNF-on-abandon
  have no solo analog, and reusing solves would contaminate the frozen PB invariant. Reuse = generator, GUID
  types, valid|dnf vocab, current_active_user — the SERVICE seams, not the table.
- Start idempotent, always 200 with current attempt (incl. terminal) + shared weekly scramble; re-revealing
  an already-seen weekly scramble to the same committed user carries no new info → does not violate П8.
- Shared weekly scramble is П8-compatible: one scramble for all, but each user sees it only AFTER their
  attempt row is recorded (the confirm); no per-user pre-practice window remains. The forbidden pattern
  (public GET returning scramble) is NOT added.
- DNF-on-abandon = deadline-based only (started_at+window); leftover started rows → future finalize-cron.
  Real-time abandon needs WS (Этап 4). We do NOT claim realtime abandon works.
- honesty=pending recorded from day 1; the endpoint is plumbing/self-report until the honesty brick; no
  Этап-5 standings query may read pending as trusted.
