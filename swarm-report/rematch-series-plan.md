# Plan: Реванш-серии (running series score, not lifetime h2h)   (slug: rematch-series)

## TL;DR
Series score is **derived**, not stored: `DuelRoom.rematch()` already creates a child room with
`parent_room_id = parent.id` (UNIQUE column ⇒ a singly-linked list). Walking that chain upward from
the current room to its root, filtering to `status == "finished"`, and cutting the walk when the gap
between games exceeds `DUEL_SERIES_GAP_SECONDS` gives the current-sitting score with zero migration,
zero new tables, zero writes to `solves`. Exposed as a new read-only `GET /duel/rooms/{room_id}/series`
endpoint (kept separate from `/h2h` to avoid touching its frozen contract), rendered as a second line
under the existing h2h line on the result panel, shown only once `played >= 2`.

## Acceptance criteria
- Two players duel, click "Реванш", play a second game: result screen of game 2 shows
  "В этой серии 2 игры, счёт 2:0" (or 1:1) **under** the existing "Вы играли N раз…" line.
- Result screen of the very first duel shows no series line (`played == 1`).
- `GET /duel/rooms/{id}/series` returns 200 with exactly the keys
  `played / your_wins / opponent_wins / draws`; 401 for anonymous; 404 for a non-participant, for a
  non-existent room, and for a room the opponent never joined (`player_b_id is None`).
- Response body contains no email, no nickname, no UUID of any kind (asserted by test).
- A rematch created more than `DUEL_SERIES_GAP_SECONDS` after the previous game's end starts a new
  series: `played == 1`.
- An abandoned room inside the chain does not count toward `played`, but does not break the chain
  for games played after it.
- A draw does not count toward either player's wins: 3 games, 1 draw → "счёт 1:1 (+1 ничья)".
- `rematch()` on a room whose parent is not yet `finished` (open/full/active) returns a clean 409
  instead of crashing with a 500 on the partial-unique-index insert.
- Full backend `pytest` and frontend `vitest`/`typecheck`/`lint`/`prettier` suites stay green,
  including `frontend/tests/i18n/coverage.test.ts` and `backend/tests/test_env_example.py`.
- The series line is translated: English locale renders it in English, Russian in Russian.

## Plan

### Design decisions
- **D1 — derive, don't store.** No table, no column, no migration — same move as `GET /daily/streak`
  (`app/services/streak.py`). The chain is already encoded via `parent_room_id`.
- **D2 — ascend only, current room inclusive.** Series score for room C = ancestors of C + C itself.
  Descendants (future rematches) are not included, so the score on an old result screen never changes
  retroactively when a new game is played later.
- **D3 — a time gap breaks the chain.** Walking parent → child, a link is dropped when
  `child.created_at - (parent.finished_at ?? parent.created_at) > DUEL_SERIES_GAP_SECONDS`
  (new setting, default 3600s = "one sitting"). A rematch a week later is a new series of one game,
  not "12:9 in this series" — lifetime already covers that via `/h2h`.
- **D4 — separate endpoint, not a field on `DuelH2HRead`.** Reasons: `/h2h`'s contract stays frozen;
  adding a required field breaks ~8 fixture literals in `DuelResult.test.tsx`; both panel lines are
  cosmetic/best-effort and can fail independently. Same guard shape as `get_h2h` (participant check,
  404 when `player_b_id is None`).
- **D5 — no identifiers in the response.** Exactly four integers:
  `played / your_wins / opponent_wins / draws`. Unlike `DuelH2HRead`, no `opponent_user_id` — §П10,
  the opponent is nameless on this surface.
- **D6 — counting rule.** Only chain rooms with `status == "finished"` count toward `played`.
  An `abandoned` room does not break the chain (the parent→child link still holds through it) but is
  not a game. `winner_id IS NULL` on a finished room → `draws`. A `winner_id` matching neither of the
  pair (defensive case) counts toward `played` but not toward either player's wins.
- **D7 — display threshold.** Frontend renders the series line only when `played >= 2`. The backend
  always returns the true count; the threshold is a display rule (avoids "в этой серии 1 игра, счёт
  1:0" duplicating the result headline above it).
- **D8 — rematch is a mutual-click flow, not a push invitation (explicit scope boundary).** The
  opponent is not notified out-of-band that a rematch room was created; the series only advances when
  both players independently click "Реванш". This mirrors the existing rematch flow as already
  shipped and is **not** something this plan changes — see Known limitations below for why.

### Invariants respected
- §П5: endpoint is strictly read-only. Zero writes anywhere, `solves` least of all. No migration.
- `honesty`: never read, never referenced, gates nothing new.
- §П10: response carries zero human identifiers — four counters only.
- `WEB_CONCURRENCY=1` / in-memory `duel_manager`: the new endpoint reads only from Postgres via the
  existing session, never touches `duel_manager` or any process-local state.

### Affected files
- `backend/app/config.py` — add `DUEL_SERIES_GAP_SECONDS: int = 3600` next to the other `DUEL_*`
  settings, with a comment explaining the "one sitting" semantics.
- `backend/.env.example` — add `DUEL_SERIES_GAP_SECONDS=3600` (required or `test_env_example.py` fails).
- `backend/app/services/duel.py`
  - Extract `_as_utc(dt)` (sqlite gives naive datetimes, Postgres gives aware ones — same trap
    `_invite_expired` already navigates) into a shared helper, reuse it.
  - `@dataclass(frozen=True) SeriesCounts(played, your_wins, opponent_wins, draws)`.
  - Pure `series_chain(rooms_by_id: dict[UUID, DuelRoom], room_id: UUID, gap_seconds: int) -> list[DuelRoom]`
    — ascends via `parent_room_id`, with a `seen` set for cycle protection, stops at a missing parent,
    stops if an ancestor has a different player pair (defensive), stops at the D3 gap.
  - Pure `tally_series(chain: list[DuelRoom], me_id: UUID, opponent_id: UUID) -> SeriesCounts`
    — only `status == "finished"` rooms count toward `played`; `winner_id` tallying mirrors
    `h2h_record`'s existing rule (draws are never `played - wins`).
  - `async def series_record(session, room, me_id, *, gap_seconds) -> SeriesCounts` — **one** SELECT
    of every room for this player pair (indexed by the pair, not a per-hop round trip), builds the
    `rooms_by_id` dict, then calls the two pure functions.
  - **Bug fix (from skeptic HIGH-4):** in `rematch()`, guard `if parent.status != "finished":` and
    raise the existing "room not available" error (409-style), before attempting to insert the new
    room's participants. Today a rematch clicked against a non-finished parent falls through to an
    `IntegrityError` on the partial-unique-active-participant index and re-raises bare — a 500. This
    is a pre-existing bug surfaced while building the chain-walk (the walk assumes finished parents);
    fixing it is small, contained, and directly protects the series invariant that every link in the
    chain other than the final room is `finished`.
- `backend/app/schemas/duel.py` — `class DuelSeriesRead(BaseModel)`: `played`, `your_wins`,
  `opponent_wins`, `draws`. Docstring notes why there is no `opponent_user_id` (§П10) and why this is
  derived, not a table.
- `backend/app/routers/duel.py` — `GET /rooms/{room_id}/series`, guard copied from `get_h2h`
  (participant-or-404, 404 when `player_b_id is None`), calls `series_record(...,
  gap_seconds=settings.DUEL_SERIES_GAP_SECONDS)`. Read-only, no commit. Same guard added to the
  `rematch()` route path via the service-level fix above.
- `frontend/src/api/duel.ts` — `export interface DuelSeriesRead` (four numbers) +
  `export function getSeries(roomId, signal?)`.
- `frontend/src/duel/DuelResult.tsx` — new prop `series: DuelSeriesRead | null`; second line under
  h2h when `series.played >= 2`. Replace the local, dictionary-bypassing `pluralizeRu` copy with
  `pluralRu` from `../i18n/plural`; both the h2h line and the new series line are built through
  `t(pluralRu(n, PHRASES), { n, you, opp })` so the Russian byte-output of the existing h2h line does
  not change (existing assertions keep passing unmodified) while it becomes translatable.
- `frontend/src/pages/DuelPage.tsx` — `const [series, setSeries] = useState<DuelSeriesRead | null>(null)`,
  reset alongside h2h on room-id change, fetched in the existing result-phase effect under the same
  `AbortController` as the h2h fetch (best-effort, independent failure), prop passed to `DuelResult`.
- `frontend/src/i18n/en.ts` — English forms for: three plural forms of "В этой серии {n} игра/игры/игр,
  счёт {you}:{opp}"; three plural forms of "(+{n} ничья/ничьи/ничьих)"; and — since the h2h line moves
  into the dictionary as part of this change — the two existing plural forms of "Вы играли {n}
  раз(а), счёт {you}:{opp}". Placeholders must match between key and value (dictionary-health test).
- `frontend/tests/duel/DuelPage.test.tsx` — add `getSeries: vi.fn()` to the `vi.mock('../../src/api/duel')`
  factory (missing export ⇒ undefined-is-not-a-function failure).
- `frontend/tests/duel/DuelResult.test.tsx` — add `series: null` to `defaultProps`.
- `backend/tests/test_duel_series.py` — new file, see Test plan.
- `backend/tests/test_duel_rematch.py` (or existing duel test file) — add the parent-not-finished
  409 regression test for the `rematch()` bug fix.
- `frontend/tests/duel/DuelSeries.test.tsx` — new file (or folded into `DuelResult.test.tsx`), see
  Test plan.
- `.memory-bank/product-overview/roadmap.md` — mark "Реванш-серии" V2 line done, link to
  `GET /duel/rooms/{id}/series`, note "derived from parent_room_id, no table".
- `.memory-bank/tasks/README.md` — short paragraph next to the h2h entry.

### Known limitations (explicit scope boundary, not fixed here)
- **Opponent is not pushed a rematch invitation.** After a result, `rematch()` is a get-or-create with
  no consent step and no WS notification to the other player — the losing/other player's browser is
  sitting on a now-dead room socket and has no signal that a child room exists. The series score only
  grows when *both* players separately click "Реванш" on their own screens. This is the shape the
  rematch flow already ships in (predates this plan); building a push invitation would mean keeping
  the finished room's WS session alive past `_cleanup` and adding a new server→client frame — a
  materially larger change than "compute a score from data that already exists," and orthogonal to
  it. Left alone; flagged for a follow-up ticket if the product wants the series to feel connected
  in real time rather than opt-in-per-player.
- **Stale duel rooms are never swept.** `rematch()` creates a `full` room with two `active`
  participants immediately; if neither player opens the room's websocket, `prep_timeout` never arms
  (it only starts once both sides activate) and no job sweeps `open`/`full` duel rooms the way
  `app/jobs/finalize.py` already sweeps tournament and daily state. This is a pre-existing gap in the
  rematch flow, not introduced by this feature, and fixing it means adding a new sweep job —
  out of scope for a plan about deriving a score. Left alone; noted for the record since a series
  screen very slightly increases how often `rematch()` gets clicked.
- **Series value is only visible on the post-game result screen**, not on the waiting/prep screen
  before the next game starts (where "серия 1:1, решающая" would be the most valuable framing). That
  surface has different phases, different fetch timing, and its own tests — a separate ticket.

### Steps
1. Branch `feat/rematch-series` from current `main`.
2. `config.py` + `.env.example` together in one commit (avoids a red `test_env_example`).
3. `services/duel.py`: extract `_as_utc`; add `SeriesCounts`; pure `series_chain` + `tally_series`;
   async `series_record`; the `rematch()` parent-status guard. No `session.add`/`commit` in any new
   series code.
4. `schemas/duel.py`: `DuelSeriesRead`.
5. `routers/duel.py`: `GET /rooms/{room_id}/series` mirroring `get_h2h`'s guards.
6. Backend tests (pure unit tests for `series_chain`/`tally_series` first, then route tests).
7. `api/duel.ts`: `DuelSeriesRead` + `getSeries`.
8. `i18n/en.ts`: new + migrated translation keys.
9. `DuelResult.tsx`: `series` prop, second line, h2h line moved onto `pluralRu` + `t()`.
10. `DuelPage.tsx`: state, fetch, prop threading.
11. Fix the `api/duel` mock in `DuelPage.test.tsx` and `defaultProps` in `DuelResult.test.tsx`; add
    the new frontend tests.
12. Run both suites in full plus formatters; fix anything red.
13. Update `.memory-bank` (roadmap + tasks/README).

## Test plan

### Backend — pure functions (`series_chain`, `tally_series`)
- Single room, no parent → chain of one.
- Three rooms in sequence (A→B→C): query from C → `[A, B, C]`; query from B → `[A, B]` (descendants
  are not pulled in, per D2).
- Gap strictly greater than `DUEL_SERIES_GAP_SECONDS` between `B.finished_at` and `C.created_at` →
  chain from C is `[C]`.
- Gap exactly at the boundary (`== gap`) does **not** break the chain (strict inequality).
- Parent with `finished_at is None` (abandoned) → comparison falls back to `created_at`, chain does
  not break unexpectedly.
- Naive datetime (sqlite) vs aware datetime (Postgres) give identical results — regression test on
  `_as_utc`.
- Parent not present in the fetched set → walk stops cleanly, no exception.
- Synthetic cycle in `parent_room_id` → `seen` guard breaks the loop, no infinite loop.
- Ancestor with a different player pair → chain breaks there (defensive guard).
- `tally_series`: 2 wins mine, 1 opponent's → `3/2/1/0`.
- `tally_series`: `winner_id is None` → counts as a draw, not either player's win.
- `tally_series`: `winner_id` belonging to neither pair member → not counted for either player, but
  still counted in `played`.
- `tally_series`: an `abandoned` room mid-chain → not counted in `played`; games after it still are.
- `tally_series`: caller's a/b slots swapped relative to storage order → score still correct.

### Backend — route (`GET /rooms/{room_id}/series`)
- 200: root + two rematches all finished → `{played: 3, ...}`; `your_wins + opponent_wins + draws == played`.
- Exact key set of the response is `{played, your_wins, opponent_wins, draws}` — explicit no-PII/no-UUID
  assertion (§П10).
- 401 for an anonymous caller.
- 404 for a third user who is not a participant.
- 404 for a non-existent `room_id`.
- 404 for a room the opponent never joined (`player_b_id is None`) — mirrors `/h2h`.
- Room where the opponent abandoned: 200 (player_b exists) and that room does not count in `played`.
- Rematch created more than `DUEL_SERIES_GAP_SECONDS` after the previous game's end (via
  monkeypatched setting or seeded `created_at`/`finished_at`) → `played == 1`.
- A draw (`winner_id` NULL) in the series → `draws == 1`, wins not inflated.
- Purity/§П5 guard: after calling the endpoint, `count(Solve) == 0` and no room's status changed.
- Finalization ordering regression: `_on_finalize` commits before the `result` broadcast
  (`duel_manager.py`), so the route always sees the just-finished game in `played` — no off-by-one.
- **New:** `rematch()` against a parent room whose status is not `finished` (open/full/active) returns
  a clean error, not a 500 (regression for the `rematch()` fix).

### Frontend
- `api/duel.ts`: `getSeries` hits `/duel/rooms/{id}/series` with `encodeURIComponent`, forwards `signal`.
- `DuelResult`: `series={played:2, your:2, opp:0, draws:0}` → renders "В этой серии 2 игры, счёт 2:0".
- `DuelResult`: `played == 1` → no series line (D7 threshold).
- `DuelResult`: `series === null` → no series line, h2h line still renders (independent failure).
- `DuelResult`: `draws > 0` → "(+1 ничья)" / "(+2 ничьи)" / "(+5 ничьих)" — all three plural forms.
- `DuelResult`: existing h2h assertions ("Вы играли 3 раза, счёт 2:1", "(+1 ничья)") pass unchanged
  after the line moves onto `t()` — proof the Russian output is byte-identical.
- `DuelResult` with `lang='en'`: series line renders in English.
- `DuelPage`: in the result phase, both `getH2H` and `getSeries` are called; unmount aborts both via
  the shared `AbortController`.
- `DuelPage`: `getSeries` rejecting does not crash the screen and does not block the h2h line.
- `frontend/tests/i18n/coverage.test.ts` stays green: no empty values, no untranslated Russian left
  in `en.ts`, `{n}`/`{you}`/`{opp}` placeholders match between key and value for every new/moved key.

## Blockers
None outstanding. Skeptic's HIGH findings on draw-counting (abandoned rooms) and missing series
terminator are resolved by design (D6, D3). The HIGH finding on `rematch()` crashing on a
non-finished parent is fixed as a small, contained bug fix in this same plan (step 3). The HIGH
finding on the opponent not being notified of a created rematch is an explicit, documented scope
boundary (D8 / Known limitations) rather than a blocker — fixing it requires WS/session-lifetime
redesign orthogonal to "derive a score from existing data," and the rematch flow it concerns already
ships today, unmodified by this plan.

## Out of scope
- Best-of-N formats, an explicit "series winner," badges or ranking tied to a series.
- Push-notifying the opponent that a rematch room was created (see Known limitations, D8).
- A sweep job for stale (`open`/`full`, nobody joined the socket) duel rooms (see Known limitations).
- Showing the series score before the next game starts (waiting/prep screen) — separate ticket.
- Broadcasting the series count over the room websocket (`result`/`room_state`) — REST only, as `/h2h`.
- Any migration, table, or `series_id` column.
- Removing `DuelH2HRead.opponent_user_id` (a pre-existing dead PII field the frontend never reads) —
  flagged, not touched; changing `/h2h`'s contract is a separate ticket.
- Rate-limiting `GET /rooms/{room_id}/series` — `/h2h` (its closest precedent) has no `_ip_limit`
  either; consistent with existing GET routes, not introduced or removed here.
- Any interaction with `honesty`, frames, or anti-cheat.

## Assumptions
- "Series" means the chain of rematches in one sitting, not "all meetings today" and not "first to N."
  The Memory Bank roadmap only says "уже частично в userflow" — the shape is this plan's call.
- `DUEL_SERIES_GAP_SECONDS = 3600` is a round guess at "one sitting," not derived from data; kept as
  a config setting for exactly that reason (easy to retune without a code change).
- The "В этой серии N игр, счёт X:Y" phrasing mirrors the existing h2h line's style; not
  designer-approved copy, just consistent with what already ships.
- The chain is always a single player pair (guaranteed by today's `rematch()`), but `series_chain`
  guards against a mismatched pair anyway, defensively, for the future.
- A series is never explicitly closed by anything other than the time gap — no "first to 3", no
  manual "end series" action.
