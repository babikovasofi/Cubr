# Build report: h2h-история встреч в дуэлях (slug: h2h-duel-history)

Status: **implementation complete, tests green, ready for /review.**
Autonomous plan→build: backend (sonnet) + frontend (sonnet) parallel, then full
test suite (haiku), then orchestrator verification. Pure read-only feature — no
migration, no writes.

## Backend (exec: sonnet)
- `schemas/duel.py` — `DuelH2HRead(played, your_wins, opponent_wins, draws,
  opponent_user_id: UUID)`.
- `services/duel.py` — `H2HCounts` frozen dataclass + `h2h_record(session,
  me_id, opponent_id)`: single SELECT over `DuelRoom` `WHERE status=="finished"
  AND ((player_a_id==me AND player_b_id==opp) OR (player_a_id==opp AND
  player_b_id==me))`; `func.count`/`case` aggregates — `your_wins`/
  `opponent_wins`/`draws` each counted **explicitly** by `winner_id`
  equality / `IS NULL` (never derived by subtraction). Read-only: no
  `session.add`, no commit.
- `routers/duel.py` — `GET /duel/rooms/{room_id}/h2h` (`response_model=
  DuelH2HRead`). Mirrors `get_room`'s participant guard: `current_active_user`
  + `session.get`; 404 if room None / caller not a participant; extra 404 when
  `player_b_id is None`. Opponent derived server-side (the other slot) — no
  arbitrary user-id param (skeptic HIGH#1 privacy).

api_changes: `GET /duel/rooms/{room_id}/h2h` (authed, participant-only) →
`{played, your_wins, opponent_wins, draws, opponent_user_id}`; 401 anon; 404
unknown room / non-participant / no-opponent-yet.

## Frontend (exec: sonnet)
- `api/duel.ts` — `DuelH2HRead` + `getH2H(roomId, signal?)`.
- `duel/DuelResult.tsx` — optional `h2h` prop + `pluralizeRu(n, [one, few,
  many])` (standard RU mod-100/mod-10 rule, 11–14 forced `many`), reused for
  «раз»/«ничья». Panel «Вы играли N раз, счёт X:Y (+Z ничьих)» rendered only
  when `h2h && played>0`; nothing otherwise. Component stays
  pure/presentational (no fetch inside). Placed under the outcome heading,
  `text-caption text-muted` — no emoji, no "verified"/"подтверждено" copy.
- `pages/DuelPage.tsx` — `h2h` state, fetch on `phase==="result"` with
  `AbortController` (mirrors the existing badge-refetch + getRoom pattern),
  reset on `roomId` change, best-effort (error/abort → null). Threaded into
  `<DuelResult h2h={h2h}/>`.

Skeptic resolutions verified: room-scoped endpoint (HIGH#1); `finished`-filtered
symmetric aggregation counted by winner_id (HIGH#2); AbortController fetch (MED);
rematch children counted per-row, explicit opp_wins, no "verified" copy, timing
safe (finalize commits before the WS `result` broadcast).

## Tests (haiku) + orchestrator verification
- Backend `tests/test_duel_h2h.py` (12) — `h2h_record` mixed winners +
  symmetry; abandoned excluded; non-finished (open/full/active) excluded;
  third-user isolation; rematch-child counted (played==2); slot symmetry;
  endpoint auth (anon 401 / non-participant 404 / unknown 404); no-opponent
  (open room → 404); happy path both directions (opponent_user_id==B, wins
  swapped); §П5 read-only (Solve count + DuelRoom rows unchanged).
- Frontend `tests/duel/` (24) — `getH2H` URL + typed return + signal;
  `DuelResult` panel (3→«играли 3»/«2:1»/no «(+»; draws>0→«(+1»; played:1→
  singular «раз»; null/played:0→no panel); DuelPage fetch-on-result + best-effort.

Orchestrator-run verification (not trusting agent self-reports; also removed a
dead/broken helper the test agent left — `_create_and_join_room` with an invalid
`pytest.asyncio.AsyncSession()`, never called):
- Backend: `pytest` **218 passed**; `ruff check app tests` clean; `mypy app`
  clean (47 files).
- Frontend: `vitest` **382 passed** (40 files); `tsc` clean; `eslint` clean.

## Open / not covered
- Two-browser live view of the panel (needs a real finished duel between two
  accounts) — logic is unit+integration tested; panel wiring is tsc/RTL-verified.
- Read-only feature: no migration, no writes — nothing to run against Postgres
  beyond the existing schema.
