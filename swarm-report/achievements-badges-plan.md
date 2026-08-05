# Plan: Ачивки и бейджи (achievements-badges)   (slug: achievements-badges)

## TL;DR
Event-driven badge award engine fired from the three existing write paths —
`POST /solves`, duel finalize (`_on_finalize`), tournament submit — awarding
inside the **caller's** session/transaction before its single commit, **never
its own session**. Idempotent grant (`UNIQUE(user_id, code)` + `begin_nested`
SAVEPOINT + IntegrityError→already-held), and **best-effort**: a badge-engine
failure is caught at each call site and NEVER aborts the primary write.
Frontend: badge grid in the profile (`GET /badges`) + toast on earn
(`new_badges[]` on the solve/tournament responses; duel result via client
refetch-diff). Badges are explicitly participation / self-reported — never
honesty-gated, never presented as "verified". §П5 PB-invariant untouched;
duels still write zero `solves`.

**Skeptic returned `revise` (7 HIGH); all resolved in this merge — no open
blockers.** Key resolutions: (1) award engine takes the caller's `AsyncSession`
and writes in the same txn/commit on every path (HIGH#1); (2) awarding wrapped
in `try/except` at each call site → primary write always commits (HIGH#2);
(3) «гроза авторитетов» redefined against real `User.best_single_ms` — dropped
the uncomputable rating dependency (HIGH#3); (4) `UNIQUE(user_id, code)` +
`begin_nested` idempotency (HIGH#4); (5) honesty decision below (HIGH#5);
(6) award writes ONLY `user_badges` — invariant test (HIGH#6).

## Honesty decision (skeptic HIGH#5 — resolved, not blocking)
Every existing result in this MVP is self-reported (`honesty="pending"` for
tournament + duel; solve `time_ms` client-supplied). Badges follow the SAME
posture: they are **participation / self-reported achievements**, never
honesty-gated, and the copy never claims verification. This is consistent with
the shipped tournament/duel bricks and the frozen §П5 note (no trusted honesty
verdict axis exists yet). When a verified-honesty setter lands, badges can add
a separate verified tier — out of scope here. No award path reads any honesty
field (tested).

## Acceptance criteria
- Valid solve `time_ms < 30000` via `POST /solves` grants `sub_30` once; the
  201 response carries it in `new_badges`; a second sub-30 solve → `new_badges`
  empty, no duplicate row.
- Duel finalize where the caller is `winner_id` grants `first_duel_win` exactly
  once ever; `winner_id is None` (tie) grants no win badge to anyone.
- A user's 10th **finished** duel (status `finished`, abandoned excluded; player
  is player_a or player_b) grants `ten_duels` once.
- Winning a duel against an opponent whose `best_single_ms` is set and strictly
  `< ` the winner's (or the winner's is null) grants `giant_slayer`; otherwise
  not.
- First `valid` weekly-tournament submission grants `weekly_debut`; the submit
  response carries it in `new_badges`; a later valid/dnf submit adds no
  duplicate.
- `GET /badges` (authed; anon → 401) returns the full registry for the caller
  with `earned`/`earned_at` per code; ProfilePage renders an earned/locked grid.
- A toast «Бейдж получен: <title>» fires after a solve/tournament response that
  carries `new_badges`; the duel result screen toasts badges earned during that
  duel (client refetch-diff, best-effort).
- **Best-effort**: if the award engine raises, the solve/tournament/duel primary
  write STILL commits (caught + logged); no 500, no lost result.
- No award path reads/writes any honesty field; §П5 PB-invariant untouched — a
  full duel still writes zero `solves`, `best_single_ms` semantics unchanged.
- Idempotent under duplicate finalize/submit/solve — awarding never raises on an
  already-held badge.
- ruff / mypy(strict, scope) / tsc / lint clean; all backend + frontend tests green.

## Plan

### Backend — model + migration
- **`models/user_badge.py`** — `UserBadge`: `id` GUID PK, `user_id` FK(user,
  CASCADE) index, `code` String(64), `earned_at` DateTime(tz) server_default
  `now()`. `__table_args__ = UNIQUE(user_id, code)` — the idempotency constraint.
  Portable `GUID` (fastapi_users_db_sqlalchemy.generics). Docstring invariant:
  never honesty-gated, never links `solves`.
- **`models/__init__.py`** — import/export `UserBadge` (keep `__all__` sorted).
- **`migrations/versions/0008_user_badges.py`** — hand-written, `down_revision =
  "0007_duel_rooms"`; `create_table user_badges` (portable UUID cols like 0007),
  FK user CASCADE, ix on user_id, `UNIQUE(user_id, code)`. Full UNIQUE (no
  partial) → no `sqlite_where`. No FK/touch to `solves`.
- **`tests/conftest.py`** — add `UserBadge.__table__` to the `create_all` list
  (tests build tables directly, not via Alembic).

### Backend — award engine
- **`services/badges.py`** — code registry + engine, all pure of honesty:
  - `BADGE_REGISTRY: dict[str, BadgeDef]` — `BadgeDef(code, title, description,
    icon)` for `sub_30`, `first_duel_win`, `ten_duels`, `giant_slayer`,
    `weekly_debut`. Registry is the single source of metadata (no
    badge-definition table; only grants persist).
  - `async grant(session, user_id, code) -> bool` — insert `UserBadge` inside
    `session.begin_nested()`; `IntegrityError` → return `False` (already held);
    else `True`. Mirrors `tournament.get_or_create_*` shape. Assumes `code` is a
    registry key (assert).
  - `async evaluate_solve(session, user, status, time_ms) -> list[str]` —
    `sub_30` when `status == "valid"` and `time_ms is not None and time_ms <
    30000`. Returns codes actually newly granted (grant → True).
  - `async evaluate_tournament_submit(session, user, attempt) -> list[str]` —
    `weekly_debut` when `attempt.status == "valid"`.
  - `async evaluate_duel_finalized(session, room) -> dict[uuid, list[str]]` —
    for the room's players: win badges only when `room.winner_id is not None`
    (guard the tie). Winner gets `first_duel_win`; `giant_slayer` when the
    LOSER's `best_single_ms` is set and `< ` winner's (or winner's null) —
    load both `User` rows. `ten_duels` for any player whose COUNT of `finished`
    DuelRoom (player_a or player_b) has reached 10 (lazy re-eval each finalize —
    self-heals a missed threshold; UNIQUE stops a double-grant).
  - `async list_badges_for(session, user_id) -> list[BadgeRead-dict]` — registry
    rows merged with the user's earned rows (`earned`, `earned_at`).
  - Returns only codes that grant() reports newly granted, so `new_badges`
    reflects THIS event, not history.
- **Call-site best-effort wrapper (HIGH#2)**: each router/callback wraps the
  `evaluate_*` call in `try/except Exception: logger.exception(...); badges = []`
  — a badge-engine fault must never fail the solve/tournament/duel. The
  `begin_nested` inside `grant` already isolates a partial badge insert from the
  sibling primary insert flushed earlier in the same request (same reasoning as
  tournament nonce race vs the solve insert).

### Backend — schemas + routers
- **`schemas/badge.py`** — `BadgeRead(code, title, description, icon, earned:
  bool, earned_at: datetime | None)`.
- **`routers/badges.py`** — `GET /badges` (`current_active_user`) →
  `list[BadgeRead]` via `list_badges_for`. Docstring: authed-only, never reads
  honesty. `main.py` — `include_router(badges.router)`.
- **`schemas/solve.py`** — add `new_badges: list[BadgeRead] = []` to `SolveRead`
  (additive optional).
- **`routers/solves.py`** — in `create_solve`, before the single commit call the
  best-effort `evaluate_solve(session, user, payload.status, payload.time_ms)`;
  attach to the returned `SolveRead.new_badges`. PB/scramble logic untouched.
- **`schemas/tournament.py`** — add `new_badges: list[BadgeRead] = []` to
  `TournamentAttemptRead`.
- **`routers/tournament.py`** — in `submit_attempt`, after setting the attempt
  status and before commit, best-effort `evaluate_tournament_submit`; pass into
  the read. `start` returns `[]`.
- **`routers/duel.py`** — in `_on_finalize`, after `finalize_room(...)` and
  before commit, best-effort `evaluate_duel_finalized(session, room)` for both
  players inside that callback's OWN session. `FinalizeCallback` signature and
  the WS `result` message are NOT changed (duel toast is client-side
  refetch-diff — see risks).

### Frontend
- **`api/badges.ts`** — `BadgeRead` type + `getBadges() -> BadgeRead[]`.
- **`api/solves.ts`** — add `new_badges?: BadgeRead[]` to `SolveRead`.
- **`api/tournament.ts`** — add `new_badges?: BadgeRead[]` to the attempt read.
- **`components/BadgeGrid.tsx`** — presentational grid: earned (title/icon/
  earned_at) vs locked (dimmed), from `getBadges()`; reuse ProfilePage card
  styling. Own loading/error state.
- **`pages/ProfilePage.tsx`** — mount `<BadgeGrid/>` section.
- **`pages/SoloPage.tsx`** — after `createSolve` resolves, toast each
  `r.new_badges` («Бейдж получен: <title>», success). (Verify call site.)
- **`pages/TournamentPage.tsx`** — after submit resolves, toast each `new_badges`.
- **`duel/DuelResult.tsx` / `pages/DuelPage.tsx`** — snapshot earned codes via
  `getBadges()` on duel mount; on entering the result phase refetch and toast
  any new code (StrictMode-safe; profile grid is source of truth, toast miss is
  cosmetic).

## Test plan
Full coverage. haiku test agent authors exactly these.

### Backend — `tests/test_badges.py`
- Registry well-formed: unique codes, non-empty titles/descriptions, every
  registry code is a valid grant target.
- `grant` idempotent: second grant of same `(user, code)` → `False`, exactly one
  `user_badges` row (begin_nested/IntegrityError path exercised).
- `evaluate_solve` boundaries: valid 29999 → `[sub_30]`; valid 30000 → `[]`;
  valid 30001 → `[]`; dnf 5000 → `[]`; second sub-30 → `[]` (already held).
- `evaluate_tournament_submit`: `valid` → `[weekly_debut]`; `dnf` → `[]`; second
  valid → `[]`.
- `evaluate_duel_finalized`: winner gets `first_duel_win` once, loser doesn't;
  `winner_id is None` → no win badge to either; repeat finalize → `[]`
  (idempotent); `ten_duels` fires only on the 10th finished duel (9 → none, 10 →
  `ten_duels`), abandoned rooms not counted; `giant_slayer` when loser
  `best_single_ms` set and `< ` winner's (or winner null) else not.
- **Best-effort (HIGH#2)**: monkeypatch an evaluator to raise → the call-site
  wrapper swallows it and returns `[]` (assert no exception escapes; the wrapper
  is what the routers use).
- **Invariant (HIGH#6/§П5)**: after a sub-30 solve + a full duel, `solves` row
  count and `best_single_ms` match the existing PB test; `UserBadge` has no
  honesty column and `evaluate_*` never reads honesty (grep-style assert the
  engine module imports no honesty field / assert award writes only user_badges).

### Backend — integration (`tests/test_badges_api.py` or extend existing)
- `POST /solves` sub-30 → 201 with `new_badges` containing `sub_30`, row
  persisted; second sub-30 → `new_badges` empty. anon `POST /solves` unaffected.
- `POST /tournament/current/attempt/submit` valid → `new_badges` has
  `weekly_debut`; a full tournament flow still writes zero `solves`.
- `GET /badges` → grid with earned/locked flags correct; anon → 401.
- Duel finalize (drive via the duel service/manager as the duel tests do) grants
  the winner `first_duel_win` and persists it; primary duel finalize still
  succeeds even if the award engine is monkeypatched to raise.

### Frontend
- `api/badges.test.ts` — `getBadges` parses the grid.
- `components/BadgeGrid.test.tsx` — renders earned vs locked (dimmed) correctly.
- `pages/SoloPage`/`TournamentPage` toast test — a `createSolve`/submit resolving
  with `new_badges` fires a toast per badge (mock toast); empty → no toast.
- `duel/DuelResult` refetch-diff test — a code present after result but not in
  the mount snapshot → toast; an already-owned code → no toast.

## Blockers
None — all 7 skeptic HIGH resolved in this merge (session sharing, best-effort
non-abort, giant_slayer redefinition, UNIQUE idempotency, honesty decision,
PB-invariant test, winner=None guard). Proceed to /build.

## Out of scope
- Badge tiers / progress bars / a notifications center.
- Retroactive backfill for pre-existing solves/duels/tournament history.
- Any honesty-gated / "verified" badge (no trusted honesty verdict exists yet).
- Badge revocation, sharing, or a badges leaderboard.
- Threading per-player `new_badges` through `FinalizeCallback` / the WS `result`
  message (kept as a future option; duel toast uses client refetch-diff here).

## Assumptions
- Badge metadata lives in a code registry in `services/badges.py`; only granted
  rows persist (no badge-definition table).
- `weekly_debut` (first valid tournament submission) gives the tournament hook a
  concrete computable badge.
- `giant_slayer` := winner beat an opponent whose `best_single_ms` is set and
  strictly `< ` the winner's (winner null counts as beaten-by-better) —
  computable from existing `User.best_single_ms`.
- `ten_duels` counts `finished` DuelRooms only (abandoned excluded) so a
  disconnect-abandon doesn't inflate it.
- Migration head is `0007_duel_rooms` on this branch (verified) → new migration
  is `0008`.
- SoloPage/TournamentPage are the `createSolve`/submit call sites for toast
  wiring (verify exact sites during build).
