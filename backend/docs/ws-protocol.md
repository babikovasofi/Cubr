# Duel WS protocol (Stage 4 — duel by link)

Source of truth for the realtime duel wire format. Implemented by
`app.routers.duel` (handshake + frame dispatch) and
`app.services.duel_manager` (in-memory room state machine). The frontend
counterpart is `frontend/src/duel/useDuelSocket.ts` + `duelMachine.ts`.

## Transport

- **Endpoint:** `GET /duel/ws/{room_id}?token=<session_token>` (WebSocket
  upgrade). In dev the browser hits `/api/duel/ws/...`; Vite proxies it to the
  backend root with `ws: true` (same-origin so the `cubr_auth` cookie rides
  along — see `frontend/vite.config.ts`).
- **Frame format:** every frame is a single JSON object with a `type` field.
  Malformed frames (non-JSON, non-object) are ignored, not fatal.
- **Single worker only.** All room state is in this process's memory; there is
  no Redis/cross-worker sharing. `app.main`'s startup refuses to boot with
  `WEB_CONCURRENCY > 1`.

## Handshake (CSWSH-hardened)

Checked in this order; any failure closes the socket with the noted code
(the socket is `accept()`-ed first, so the close arrives as the first event):

1. **Origin allowlist** — `Origin` not in `DUEL_ALLOWED_WS_ORIGINS` → close
   **4403**. (A WS handshake is not covered by CORS/CSRF; browsers send
   cookies on cross-origin WS freely, so this is the CSWSH guard.)
2. **Cookie auth** — no/invalid `cubr_auth` JWT → close **4401**
   (`app.services.ws_auth.get_ws_user`).
3. **Signed token** — `?token=` fails `duel_token.verify`, or its embedded
   `(room_id, user_id)` doesn't match the path `room_id` and the
   cookie-authenticated user → close **4401**. Binding `user_id` (not just
   `room_id`) is what stops a leaked invite URL from letting a third account
   reconnect as a real player.
4. **Membership** — room missing, `player_b` not yet joined, or caller isn't
   `player_a`/`player_b` → close **4404**.

A finished/abandoned room short-circuits into a DB-sourced terminal snapshot
(see "Terminal rooms" below) instead of the live engine.

`useDuelSocket.ts` treats **4401/4403** as fatal (no reconnect); any other
close code triggers reconnect-with-backoff.

## Client → Server frames

| type | fields | meaning |
|------|--------|---------|
| `join` | — | Request a `room_state` snapshot. Sent on every open, incl. reconnect. The server never pushes `room_state` unprompted. |
| `status_update` | `phase`: `preparing`\|`ready`\|`solving`\|`finished` | Report own coarse ritual phase. Relayed to the opponent. `ready` from both → `countdown`. |
| `finish` | `time_ms`: int>0, `dnf`: bool, `verify_frames_ok`: bool | Self-reported solve result. `time_ms` required even on `dnf`. Idempotent (a second `finish` is ignored). Both submitted → `result`. |
| `ping` | — | Heartbeat + reconnect keepalive. Answered with `pong`. Any inbound frame also refreshes the liveness timer. |

Unknown/invalid frames are silently ignored (connection stays open).

## Server → Client frames

| type | fields | trigger |
|------|--------|---------|
| `room_state` | `phase`, `event`, `scramble`, `opponent_present`, `opponent_phase`, `prep_deadline_at`, `server_start_at`, `solve_deadline_at`, `result` | Reply to `join`. Bootstrap/reconnect snapshot. `scramble` is `null` until revealed. |
| `start` | `scramble`, `event`, `prep_deadline_at` | Both players connected → room activated. **The only place the scramble is ever revealed.** |
| `status_update` | `player`: `a`\|`b`, `phase` | Opponent reported a phase change. `player` is the *sender's* slot. |
| `countdown` | `server_start_at` (ISO, future) | Both players `ready`. Synchronized start signal (human-level gate over the camera, not a time source). |
| `result` | `players`: [{`slot`,`status`,`time_ms`}], `winner_id` (str\|null) | Both finished, or a phase timeout / disconnect-DNF finalized the room. `winner_id` null = draw. |
| `opponent_left` | `grace_seconds` | Opponent's connection dropped. |
| `abandoned` | — | Disconnect grace expired before the solve started → room abandoned. |
| `pong` | — | Reply to `ping`. |

Scramble secrecy: `scramble` appears ONLY in `start` and (once revealed) in
`room_state`. No REST response ever carries it (`GET /duel/rooms/{id}` omits
the field entirely).

## Room state machine (server, per `RoomState`)

```
waiting ──(both connected)──▶ prep ──(both ready)──▶ countdown ──▶ solving ──▶ finished
   │                           │                                      │
   │                           └──(prep deadline, not-ready = DNF)─────┤
   │                                                                   │
   └──(disconnect, grace expires)──▶ abandoned          (solve deadline / both finish
                                                          / disconnect-DNF)──▶ finished
```

The internal phases map to the wire `phase` vocabulary via `_PHASE_WIRE`
(`waiting→waiting_opponent`, `prep→preparing`, `countdown→countdown`,
`solving→solving`, `finished→result`, `abandoned→opponent_left`). The client
adds purely local phases (`connecting`, `ready_wait`, `duel_already_active`,
`room_not_found`) that are never broadcast.

### Timeouts (config `DUEL_*`)

- **prep** ≤ `PREP_TIMEOUT` (180s): anyone not `ready` by the deadline → `dnf`.
- **solving** ≤ `SOLVE_TIMEOUT` (600s): anyone without a `finish` → `dnf`.
- **disconnect before solving:** `DISCONNECT_GRACE` (60s) to reconnect, else
  `abandoned`.
- **disconnect during solving (disconnect-DNF):** the leaver is recorded
  `dnf` and the room finalizes immediately with the survivor's current
  outcome. The survivor's outcome stays `pending` if they hadn't submitted —
  and `pending` beats `dnf` in `compute_winner`, so the survivor wins even
  without a submitted time, and the match ends promptly instead of hanging
  until the solve deadline.
- **heartbeat:** a per-room watchdog forces a disconnect for any connection
  silent longer than `HEARTBEAT_TIMEOUT` (15s); the client pings every
  `HEARTBEAT_INTERVAL` (5s).

### Winner (`compute_winner`, pure, honesty-agnostic)

Rank `valid`(2) > `pending`/no-result(1) > `dnf`(0). Higher rank wins; equal
rank at `valid` → smaller `time_ms`, tie broken by earliest `finished_at`;
equal otherwise → draw (`winner_id = null`). `honesty` is **never** read.

## Terminal rooms

Once `finished`/`abandoned`, the in-memory `RoomState` is torn down. A WS
reconnect to such a room does NOT re-enter the live engine (that would
resurrect the duel with a fresh scramble); the router serves a `room_state`
built straight from the DB row and otherwise idles (answering only
`join`/`ping`), letting the client close normally.

## Honesty & PB invariants (§П5)

- Every duel's `a_honesty`/`b_honesty` stay `pending` forever — plumbing only,
  never transitioned, never gates `winner_id`.
- `verify_frames_ok` is stored raw, never read as a verdict.
- `time_ms` is self-reported. True ms-lockstep is not guaranteed; the
  `countdown`/`server_start_at` signal gates the start at the human level, it
  is not the time source.
- A duel writes **zero** `solves` rows — the PB / `best_single_ms` invariant is
  untouched.

## Out of scope (this brick)

Matchmaking/queue, "risk" mode, Ao5 averages, cup/rating award,
ranked honesty-gating, OpenCV frame re-check / event-stream anti-cheat
(blocked on R1), Redis/multi-worker room sharing, full accept/timeout rematch
negotiation (reduced to an idempotent button), and `scramble_token`/nonce for
duels (scramble is plain text here).
