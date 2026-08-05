# Build report: Ачивки и бейджи (slug: achievements-badges)

Status: **implementation complete, tests green, ready for /review + live migration.**
Autonomous plan→build cycle: backend (sonnet) + frontend (sonnet) in parallel,
then full test suite (haiku), then orchestrator verification.

## Backend (exec: sonnet)
Changed/added:
- `app/models/user_badge.py` (new) — `UserBadge`: GUID PK, `user_id` FK(user,
  CASCADE, indexed), `code` String(64), `earned_at` DateTime(tz) server_default
  now(), `UNIQUE(user_id, code)` = idempotency constraint. `models/__init__.py`
  exports it.
- `migrations/versions/0008_user_badges.py` (new) — `down_revision="0007_duel_rooms"`
  (verified linear single head), mirrors 0007's portable-UUID/FK/index style,
  `UNIQUE(user_id, code)`, no touch to `solves`.
- `services/badges.py` (new) — `BADGE_REGISTRY` (5 codes, RU titles): `sub_30`,
  `first_duel_win`, `ten_duels`, `giant_slayer`, `weekly_debut`. `grant(session,
  user_id, code) -> bool` (insert inside `begin_nested()`; IntegrityError →
  `False`). Evaluators `evaluate_solve` / `evaluate_tournament_submit` /
  `evaluate_duel_finalized` + `list_badges_for` + `registry_entry`. Pure of
  honesty; writes only `user_badges`.
- `schemas/badge.py` (new) — `BadgeRead(code, title, description, icon, earned,
  earned_at)`. `routers/badges.py` (new) — `GET /badges` (authed, 401 anon),
  wired in `main.py`.
- Hooks (all **best-effort**: `try/except Exception: logger.exception(...)`,
  awarding in the caller's session BEFORE its single commit):
  - `routers/solves.py` `create_solve` → `evaluate_solve`; response built via
    `SolveRead.model_validate(...).model_copy(update={"new_badges": ...})` since
    `new_badges` is not a mapped column.
  - `routers/tournament.py` `submit_attempt` → `evaluate_tournament_submit`
    (`start` returns `[]`).
  - `routers/duel.py` `_on_finalize` → `evaluate_duel_finalized(session, room)`
    inside the callback's OWN session, before commit. `FinalizeCallback`
    signature + WS `result` message UNCHANGED.
- `schemas/solve.py` / `schemas/tournament.py` — additive optional
  `new_badges: list[BadgeRead] = []`.

Skeptic HIGH resolutions verified in code: shared caller session (HIGH#1);
best-effort try/except at every hook (HIGH#2); `giant_slayer` via
`best_single_ms`, no rating dep (HIGH#3); `UNIQUE + begin_nested` (HIGH#4);
never reads honesty (HIGH#5); writes only `user_badges` (HIGH#6); `winner_id is
None` tie guard (MED).

## Frontend (exec: sonnet)
- `api/badges.ts` (new) — `BadgeRead` + `getBadges()`. `api/solves.ts` /
  `api/tournament.ts` — additive `new_badges?: BadgeRead[]`.
- `components/BadgeGrid.tsx` (new) — earned vs locked (`opacity-40`) grid, reuses
  ProfilePage card styling (`border-2 border-ink bg-surface`), no invented
  icons/colors (icon is backend content). Mounted in `pages/ProfilePage.tsx`.
- Toast on earn via existing `toast(message, kind)` (Toast.tsx zustand store),
  wired at the REAL call sites (plan flagged "verify exact sites"):
  - `solo/solveSave.ts` gained optional `onNewBadges` callback (keeps the pure
    module Toast/React-free); `solo/useSoloSession.ts` toasts each badge.
  - `tournament/useTournamentAttempt.ts` `doSubmit` success path.
  - `pages/DuelPage.tsx` — roomId-keyed snapshot on mount + refetch-diff on
    result-phase entry, refs reset on roomId change (rematch-safe, StrictMode-safe).
    Best-effort; BadgeGrid is source of truth.

## Tests (haiku) + orchestrator verification
- Backend `tests/test_badges.py` (40) — registry well-formed; grant idempotent;
  `evaluate_solve` boundaries (29999→sub_30, 30000/30001→[], dnf→[], dup→[]);
  tournament (valid→weekly_debut, dnf/dup→[]); duel (winner once / loser none /
  tie none / repeat idempotent / ten_duels only 10th finished, abandoned
  excluded / giant_slayer per best_single_ms); best-effort wrapper swallows a
  raised evaluator; §П5 invariants (no honesty read, solves count +
  best_single_ms unchanged, award writes only user_badges); integration
  (`POST /solves` sub-30 → new_badges + persisted / second empty; tournament
  submit → weekly_debut; `GET /badges` grid + anon 401). Deleted the interim
  `test__smoke_badges_manual.py`.
- Frontend `tests/badges/` (25) — api parse, BadgeGrid earned/locked/loading/
  error, solve+tournament toast (fires per badge / empty→none), DuelPage
  refetch-diff (new code→toast once / already-owned→none).

Orchestrator-run verification (not trusting agent self-reports):
- Backend: `pytest` **206 passed**; `ruff check app tests` clean (fixed 4 lint
  nits the test agent left); `mypy app` clean (47 files).
- Frontend: `vitest` **362 passed** (37 files); `tsc` clean; `eslint` clean.

## Review result
- Reviewer (sonnet): **ship**, 1 LOW — `new_badges[]` in the solve/tournament
  response carries `earned_at=None` (the just-granted badge's real timestamp is
  only surfaced by `GET /badges`). **Accepted, not fixed**: no UI consumes
  `new_badges.earned_at` (toast uses `title`; the profile grid reads the real
  timestamp from `GET /badges`), and stamping it would churn `registry_entry` +
  its test for a dead field. Reviewer empirically confirmed (repro script) the
  `begin_nested` SAVEPOINT never loses the primary solve/tournament/duel write
  on a duplicate-badge `IntegrityError`.
- qa-smoke (haiku): **pass** — ran **live** against Postgres: `alembic upgrade
  head` 0007→0008 succeeded; curl-drove `POST /solves` (29999→sub_30, second→[],
  30000→[]), `GET /badges` (grid + anon 401), tournament start+submit→weekly_debut.
  Duel badges (first_duel_win/ten_duels/giant_slayer) verified in the test suite
  only (need multi-user live).

## Open / not covered
- **Live migration** `alembic upgrade head` (0008) against real Postgres — tests
  build schema via `create_all`, not Alembic.
- **Duel badge toast** is client refetch-diff (best-effort) — a missed toast is
  cosmetic; the profile grid always reflects the truth. Threading per-player
  `new_badges` through the WS `result` message is a deliberate future option.
- Honesty posture: badges are explicitly participation / self-reported (never
  honesty-gated), consistent with tournament/duel. A verified tier waits on the
  honesty setter.
