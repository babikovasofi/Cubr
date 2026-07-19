# Plan: h2h-история встреч в дуэлях (h2h-duel-history)   (slug: h2h-duel-history)

## TL;DR
Head-to-head record between the two players of a duel room — «Вы играли N раз,
счёт X:Y (+Z ничьих)» — computed live (read-only) from `finished` `duel_rooms`,
shown on the duel result screen. **Room-scoped** endpoint `GET
/duel/rooms/{room_id}/h2h` (opponent derived server-side from the room the
caller participates in — NOT an arbitrary `opponent_user_id`), so it's both
privacy-safe and the only shape the client can reliably call (the result
payload carries slots + `winner_id`, never the opponent's user id). No
migration, no writes, honesty untouched (§П5 frozen).

**Skeptic returned `revise` (2 HIGH); both already satisfied by the plan.**
HIGH#1 (privacy/enumeration) → room-scoped path, opponent derived from the
room, participant-guard reused. HIGH#2 (aggregation) → `WHERE status=="finished"`
+ symmetric pair + explicit counts by `winner_id`. Plus skeptic MED: frontend
fetch uses an `AbortController` (StrictMode double-fetch guard, mirrors the
existing `getRoom` effect). No open blockers.

## Acceptance criteria
- `GET /duel/rooms/{room_id}/h2h` (authed) returns `{played, your_wins,
  opponent_wins, draws, opponent_user_id}` for the caller vs the room's OTHER
  player, counting ONLY `status=="finished"` rooms between exactly that pair
  (abandoned/open/full/active excluded).
- `your_wins = count(winner_id == caller)`; `opponent_wins = count(winner_id ==
  opponent)` (counted explicitly, NOT `played - wins - draws`); `draws =
  count(winner_id IS NULL)`; `played = your_wins + opponent_wins + draws`.
- Symmetric: calling as player A vs as player B over the same pair swaps
  your_wins/opponent_wins; played/draws identical.
- Pair matched regardless of a/b slot ((a==me,b==opp) OR (a==opp,b==me)); rooms
  involving any third user excluded; rematch-child rooms counted like any other
  finished room (one row = one game, NEVER deduped by parent_room_id); the
  just-finished current room IS included (finalize commits before the WS
  `result` broadcast — verified, no race).
- Participant-only: anon → 401; non-participant or unknown room → 404 (mirrors
  `GET /duel/rooms/{id}`); a room whose `player_b_id` is still NULL → 404.
- Endpoint writes NOTHING: zero solves, zero `duel_rooms` mutations, no honesty
  transition, no new migration.
- DuelResult renders an h2h panel with the record string; DuelPage fetches on
  entering the `result` phase (AbortController-guarded) and passes it down. The
  panel renders nothing until h2h loads, on fetch failure, or when `played==0` —
  cosmetic, never blocks the result screen.
- Copy is a plain tally — NO "verified"/"подтверждено" wording (winner_id is
  honesty-agnostic, self-reported).
- ruff / mypy(strict, scope) / tsc / lint clean; all backend + frontend tests green.

## Plan

### Backend
- **`schemas/duel.py`** — add `DuelH2HRead(BaseModel)`: `played: int`,
  `your_wins: int`, `opponent_wins: int`, `draws: int`, `opponent_user_id: UUID`
  (built by hand in the router; no `from_attributes` needed).
- **`services/duel.py`** — add `async h2h_record(session, me_id, opponent_id) ->
  H2HCounts` (dataclass or tuple `(played, your_wins, opponent_wins, draws)`).
  Single SELECT over `DuelRoom` `WHERE status == "finished" AND
  ((player_a_id == me AND player_b_id == opp) OR (player_a_id == opp AND
  player_b_id == me))`, aggregated with conditional `func.count`/`case`:
  `your_wins = count(winner_id == me)`, `opponent_wins = count(winner_id == opp)`
  (explicit, not derived), `draws = count(winner_id IS NULL)`. Reads only — no
  `session.add`, no commit. (N is small; a SQL `case` aggregate or a
  fetch-winner_ids-and-tally are both fine.)
- **`routers/duel.py`** — add `@router.get("/rooms/{room_id}/h2h",
  response_model=DuelH2HRead)`. Reuse `get_room`'s guard: `current_active_user`,
  `session.get(DuelRoom, room_id)`; 404 if room is None or caller not in
  `(player_a_id, player_b_id)`. Derive `opponent = the other of (player_a_id,
  player_b_id)`; if `player_b_id is None` (lone player_a in an open room) → 404.
  Call `duel_service.h2h_record(session, user.id, opponent_id)`, return
  `DuelH2HRead(..., opponent_user_id=opponent_id)`.

### Frontend
- **`api/duel.ts`** — add `interface DuelH2HRead { played; your_wins;
  opponent_wins; draws; opponent_user_id }` + `getH2H(roomId, signal?) -> GET
  /duel/rooms/{id}/h2h`.
- **`duel/DuelResult.tsx`** — add optional prop `h2h: DuelH2HRead | null`. When
  non-null and `played > 0`, render a small panel:
  `«Вы играли {N} {раз|раза|раз}, счёт {your_wins}:{opponent_wins}»` +
  `(draws > 0 ? " (+{draws} {ничья|ничьи|ничьих})" : "")`. Render nothing when
  `h2h == null` or `played === 0`. Component stays pure/presentational — NO
  fetch inside (preserves unit-testability). Small `pluralize` helper for
  раз/ничья (test the singular/plural boundary).
- **`pages/DuelPage.tsx`** — add `h2h` state (`DuelH2HRead | null`). On entering
  `phase === "result"` (mirror the existing badge-refetch effect), call
  `getH2H(state.roomId, controller.signal)`; best-effort — on error/abort leave
  null. Pass `h2h` to `DuelResult`. Reset to null on `roomId` change;
  AbortController cleanup on unmount (StrictMode-safe).

## Test plan
Full coverage. haiku test agent authors exactly these.

### Backend — `tests/test_duel_h2h.py` (reuse `_register_and_login`/`_switch_user`/`_relogin` + `duel_service.finalize_room`/`abandon_room` from the duel tests)
- `h2h_record` service, mixed winners: build finished A-vs-B rooms (A wins, B
  wins, draw via `winner_id=None`) through `finalize_room`; assert
  `h2h_record(A,B) == (played, A_wins, B_wins, draws)` and `h2h_record(B,A)`
  swaps wins, same played/draws.
- abandoned excluded: `abandon_room` a pair room → not counted.
- non-finished excluded: an open/full/active pair room → not counted.
- third-user isolation: A-vs-C and B-vs-C rooms don't affect A-vs-B counts.
- rematch-child counted: finalize a parent A-B and its rematch child A-B →
  `played == 2`.
- slot symmetry: one room with A as player_a and another with A as player_b both
  match the pair.
- endpoint auth: `GET /duel/rooms/{id}/h2h` anon → 401; non-participant → 404;
  unknown room_id → 404.
- endpoint no-opponent: open room (`player_b_id` NULL), creator calls → 404.
- endpoint happy path: A and B play finished rooms; A GETs → JSON `{played,
  your_wins, opponent_wins, draws, opponent_user_id == B}`; B GETs → wins swapped.
- §П5 read-only: snapshot `Solve` count + `DuelRoom` rows before/after the GET →
  unchanged (zero solves, no mutation).

### Frontend
- `api/duel.ts` `getH2H` — mock `request`, assert URL `/duel/rooms/{id}/h2h` +
  typed return.
- `duel/DuelResult.test.tsx` — `{played:3, your_wins:2, opponent_wins:1,
  draws:0}` → contains «играли 3», «2:1», no «(+»; `draws>0` variant includes
  «(+1»; `played:1` uses singular «раз»; `h2h==null` → no panel; `played:0` →
  no panel.
- `pages/DuelPage` — on phase `result`, `getH2H` called with roomId and result
  flows into `DuelResult` (mock `getH2H`); a rejected/aborted fetch leaves the
  panel absent (best-effort).

## Blockers
None — both skeptic HIGH resolved (room-scoped endpoint; `finished`-filtered
symmetric aggregation), MED (AbortController) + LOWs (rematch counted once,
explicit opp_wins, no "verified" copy, timing safe) baked in. Proceed to /build.

## Out of scope
- Any raw `/duel/h2h/{opponent_user_id}` / arbitrary user-pair lookup (rejected:
  enumeration/privacy surface).
- Cups/rating/ranked surfacing (Stage 4 excludes both).
- Honesty gating/verification (stays pending, never read — §П5 frozen).
- Per-room match list, streaks, or time-windowed history — aggregate only.
- Any write (solve or duel_rooms mutation) — read-only feature.

## Assumptions
- Room-scoped endpoint chosen because the frontend result payload carries NO
  opponent user_id (only slots + winner_id) AND to avoid the enumeration
  surface of an arbitrary id param.
- Rooms counted = `finished` only; direct + rematch-child; current just-finished
  room included; ties = `winner_id IS NULL`.
- Record wording: «Вы играли N раз, счёт X:Y (+Z ничьих)», X=your_wins,
  Y=opponent_wins, Z=draws; the «(+Z ничьих)» clause omitted when draws==0.
- `opponent_user_id` in the response is harmless (caller is already a
  participant); the panel does not require it.
- No new migration — pure SELECT over existing `duel_rooms` columns.
