# Build: Реванш-серии (rematch-series)

Plan: `swarm-report/rematch-series-plan.md`. Branch `feat/rematch-series` off current `main`
(`4646fa2`).

## What shipped

**Backend**
- `app/config.py` / `backend/.env.example` / `deploy/.env.example`: new setting
  `DUEL_SERIES_GAP_SECONDS` (default 3600) — the pause after which a rematch starts a new series.
- `app/services/duel.py`:
  - `_as_utc()` extracted from `_invite_expired` (shared naive/aware datetime normalization).
  - `SeriesCounts` (dataclass), `series_chain()` (pure — ascends `parent_room_id`, gap-cut, cycle-
    guarded, pair-guarded), `tally_series()` (pure — counts `finished`-only rooms, mirrors
    `h2h_record`'s explicit draw-counting rule), `series_record()` (one SELECT for the whole pair,
    then the two pure functions).
  - `rematch()`: new guard — a parent room that isn't `finished` now raises `DuelNotFoundError`
    (→ clean 404) instead of falling through to a raw `IntegrityError` (→ 500) on the child's
    partial-UNIQUE participant insert. Bug found while building the chain-walk invariant that every
    non-final link must be `finished`; fixed in the same PR (skeptic HIGH finding).
- `app/schemas/duel.py`: `DuelSeriesRead` (played/your_wins/opponent_wins/draws — no identifier field).
- `app/routers/duel.py`: `GET /duel/rooms/{room_id}/series`, guards mirror `get_h2h` exactly.
- `backend/tests/test_duel_series.py`: 24 new tests — 9 pure `series_chain` cases (single room, three-
  room ascend/stop-at-query-point, gap break, gap-boundary no-break, abandoned-parent fallback,
  naive/aware agreement, missing parent, cycle guard, pair-mismatch guard), 5 pure `tally_series` cases
  (mixed wins, draw, stray winner, abandoned-mid-chain, slot symmetry), and 10 endpoint/integration
  tests (401/404×3, happy path with two real rematches through the actual endpoint, abandoned-link
  exclusion, gap-starts-new-series, draw-no-inflation, §П5 read-only guard, and the `rematch()`
  non-finished-parent 404 regression).

**Frontend**
- `src/api/duel.ts`: `DuelSeriesRead` + `getSeries()`.
- `src/duel/DuelResult.tsx`: new `series` prop; second line under the h2h line, shown at
  `played >= 2`. The existing hardcoded, dictionary-bypassing `pluralizeRu`/`h2hLabel` were replaced
  with `pluralRu` (`i18n/plural.ts`) + `t()`, so the h2h line is now actually translatable — its
  Russian output is asserted byte-identical by the pre-existing tests (unchanged, still pass).
- `src/pages/DuelPage.tsx`: `series` state, fetched alongside `h2h` in the same result-phase effect
  under the same `AbortController`, independent failure (a broken series fetch doesn't hide h2h or
  vice versa).
- `src/i18n/en.ts`: English for the h2h line (newly translatable), the series line, and the draw
  suffix. Note: RU "раз" is grammatically invariant between the "one" and "many" plural buckets, so
  those two RU dictionary keys are literally identical text and both map to one English "time(s)"
  template — documented inline in `DuelResult.tsx`.
- `frontend/tests/duel/DuelResult.test.tsx`: `series: null` added to `defaultProps`; 9 new cases —
  render at `played>=2`, hidden at `played===1`, hidden at `series===null` (h2h still renders), three
  draw-suffix plural forms, `игра`/`игры` form check, English rendering, and a byte-identical-h2h
  regression check.
- `frontend/tests/duel/DuelPage.test.tsx`: `getSeries: vi.fn()` added to the `api/duel` mock factory.

**Memory Bank**
- `product-overview/roadmap.md`: "Реванш-серии" marked done.
- `tasks/README.md`: new bullet next to the h2h entry, same style, documenting the derivation, the
  rematch() bug fix, and the known limitations left alone (see below).

## Design decision I'm least sure about

Bundling the `rematch()` non-finished-parent 500→404 fix into this PR. It's a real, pre-existing bug
(a double-click race or a stale UI letting someone hit `rematch()` on an `open`/`full`/`active` room
crashes today), and it's directly load-bearing for the series invariant ("every non-final chain link
is `finished`"), but it's also touching behavior outside "derive a score from existing data." I judged
it in-scope because it's small, tested, and the plan's own chain-walk logic depends on the invariant
it enforces — but it's the one change in this PR that isn't purely additive.

## Known limitations, deliberately left alone (see plan's "Known limitations")

- **Opponent isn't pushed a rematch invitation.** `rematch()` is still get-or-create with no consent
  step and no WS notification — the series only advances when both players separately click "Реванш".
  Pre-existing shape of the rematch flow, not something this plan changes; fixing it means keeping a
  finished room's WS session alive past `_cleanup` and adding a new server→client frame.
- **Stale `open`/`full` duel rooms are never swept** — no job like `app/jobs/finalize.py`'s
  tournament/daily sweeps exists for duels. Pre-existing gap, not introduced by this feature.
- **Series is only shown on the post-game result screen**, not on the pre-game waiting/prep screen
  (where "серия 1:1, решающая" would be the most valuable framing) — different surface, different
  fetch timing, separate ticket.

## Test counts

| | before | after |
|---|---|---|
| backend pytest | 367 | 391 (+24) |
| frontend vitest | 787 | 796 (+9) |

## Checks — all green

- `cd backend && uv run pytest -q` → **391 passed**
- `cd backend && uv run ruff check .` → clean
- `cd backend && uv run ruff format --check .` → clean
- `cd backend && uv run mypy app` → clean (57 source files)
- `cd frontend && npm test` → **796 passed** (84 files)
- `cd frontend && npm run typecheck` → clean
- `cd frontend && npm run lint` → clean
- `cd frontend && npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.{ts,tsx}" "scripts/*.mjs"` → clean

## Not done / out of scope (per plan)

Best-of-N formats, an explicit series winner, badges/ranking tied to a series, push-notifying the
opponent, a stale-room sweep job, showing the series pre-game, broadcasting the series over the room
websocket, any migration/table, removing `DuelH2HRead.opponent_user_id` (pre-existing dead PII field,
flagged not touched), rate-limiting the new GET (consistent with `/h2h`, which also has none).
