# Build report: Этап 4 — дуэль по ссылке (slug: stage4-duel-by-link)

Status: **implementation complete, tests green, ready for /review + manual QA.**

## What this session did

The feature *code* (backend model/migration/service/manager/router/schemas +
frontend api/machine/socket/components/pages) was already written and wired in
a prior session but had **no real test coverage** (only a manual smoke test),
**no protocol doc**, and a **WS-test isolation gap**. This session finished the
build: full test suite, `docs/ws-protocol.md`, one correctness fix, and a
green verification pass.

### 1. Test-isolation fix — `tests/conftest.py`
The duel realtime engine's persistence callbacks (`_on_activate`/
`_on_finalize`/`_on_abandon`) open their own session via
`app.db.async_session_maker` from an `asyncio.Task`, bypassing the
`get_session` dependency override. The `sync_client` fixture now also
monkeypatches `app.db.async_session_maker` → the test sqlite session_maker, so
a WS activation hits sqlite instead of the real Postgres (this is why the old
manual smoke test hung). Removed the now-redundant `test__smoke_duel_manual.py`.

### 2. Correctness fix — `app/services/duel_manager.py` (disconnect-DNF)
Plan acceptance requires: *disconnect during solving → survivor wins even
without submitting a time.* The code instead waited for the full
`solve_timeout`, which forces DNF on **all** missing outcomes → survivor idle =
`dnf` vs `dnf` = **draw** (spec violation, and a ~10-min hang). Fix: on a
mid-solve disconnect, record the leaver `dnf` and finalize **immediately** with
the survivor's current outcome (stays `pending` if unsubmitted). `compute_winner`'s
`pending > dnf` rule then correctly awards the survivor the win, and the match
ends promptly. Documented in `docs/ws-protocol.md`.

### 3. Backend tests (51 new, all green)
- `tests/test_duel_token.py` (8) — sign/verify roundtrip, tampered sig, wrong
  secret, expired, malformed, `(user_id,room_id)` binding.
- `tests/test_duel.py` (20) — `compute_winner` (all rank/tiebreak/disconnect
  cases); create 201/anon-401; `GET` hides scramble + participant-only 404;
  **П11** create-conflict + re-create-after-finished + partial-UNIQUE actually
  trips; join (player_b/full, idempotent reconnect, third-stranger 409, unknown
  404, joiner-already-active 409); rematch double-click → one child; **§П5
  PB-invariant: full duel writes zero `solves`.**
- `tests/test_duel_manager.py` (14) — activate+shared-scramble, snapshot,
  broadcast/exclude/send, both-ready→countdown(future), both-finish→finalize,
  duplicate-finish ignored, prep/solve timeouts, disconnect-before-solve→abandon,
  reconnect-cancels-abandon, **disconnect-during-solve→survivor wins**, heartbeat
  drop, idempotent finalize + task cleanup (no leak).
- `tests/test_duel_ws.py` (9) — handshake 4401 (no cookie) / 4403 (foreign
  origin) / 4401 (token for other user); identical shared scramble + REST hides
  it; status relay; result (smaller-valid / valid-beats-dnf / both-dnf-tie);
  reconnect `join` → `room_state` with scramble.

### 4. Frontend tests (87 new, all green)
`tests/duel/{duelMachine,useDuelSocket,DuelRoom}.test.*` +
`tests/pages/DuelJoinPage.test.tsx` — reducer transitions/idempotency/fallback,
mock-WebSocket lifecycle (start/heartbeat/reconnect/idempotent-close), RTL
opponent panel + countdown overlay + reconnect affordance, join anon-redirect /
404 / 409-existing-room. (Authored by a subagent; I fixed the `tsc`-only errors
it left — `ApiError` arg order, `global`→`globalThis`, unused vars, wrong import
source for `DuelSocketApi`.)

### 5. Docs
`backend/docs/ws-protocol.md` — transport, handshake, C→S/S→C frame tables,
room state machine + timeouts, winner rule, terminal-room handling, honesty/PB
invariants, out-of-scope.

## Verification
- Backend: `pytest` **163 passed**; `ruff` clean; `mypy app` clean (43 files).
- Frontend: `vitest` **337 passed** (33 files); `tsc` clean; `eslint` clean.
- Migration `0007_duel_rooms` → `down_revision 0006`, linear single head.

## Review rework (post-`/review`, verdict was `rework` — 1 HIGH, now fixed)
Reviewer HIGH: the WS handshake closed **4404** whenever `player_b_id is None`,
so the room **creator** (player_a), whose socket mounts immediately after
`POST /duel/rooms` (`DuelPage` → `useDuelSocket`), got dropped into a reconnect
loop (4404 isn't fatal) and saw "Связь потеряна" instead of the invite panel
for the whole wait. Never caught because every WS test REST-joined both players
before opening a socket. Fixes:
- **`routers/duel.py`** — 4404 gate now rejects only an unknown room or a
  non-participant; a lone player_a may hold the socket on an `open` room.
- **`duel_manager.py`** — `RoomState.player_b_id` is now `uuid.UUID | None`;
  a lone creator sits in `waiting_opponent`, and `connect` **learns** the
  player_b id when the invitee's socket arrives, then activates and broadcasts
  `start` to both (incl. the already-waiting creator). `opponent_of`/snapshot/
  disconnect/finalize all handle the not-yet-known-opponent case.
- **Bonus bug found on the same waiting flow** — client pinged every **20s**
  but the server force-disconnects after **15s** of silence, so any idle
  client (creator waiting, or a player lingering in prep) was dropped every
  15s. `useDuelSocket.ts` `HEARTBEAT_INTERVAL_MS` 20s → **10s**.
- **New regression tests (all green):** `test_duel_manager.py::test_lone_creator_waits_then_activates_when_opponent_joins`;
  `test_duel_ws.py::test_creator_can_hold_socket_while_room_open` +
  `test_opponent_arrival_pushes_start_to_already_waiting_creator`.
- Re-verified: backend **166 passed**, frontend **337 passed**, ruff/mypy/tsc/eslint clean.

## Open / not covered (hand to review + manual QA)
- **Live migration run** (`alembic upgrade head`) against real Postgres/sqlite
  not exercised — tests build schema via `create_all`, not Alembic. Verify the
  partial-UNIQUE index + GUID render on the live DB.
- **Two-browser manual QA** of the full ritual (camera + countdown overlay +
  result + rematch) — automated tests stub the camera/solo session.
- Everything in the plan's "Out of scope" stays out (matchmaking, Ao5, ranked
  honesty-gating, OpenCV re-check, Redis multi-worker).
