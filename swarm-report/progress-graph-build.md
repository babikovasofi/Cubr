# Build report: График прогресса времён сборок (slug: progress-graph)

Status: **implementation complete, tests green, ready for /review.**
Frontend-only, read-only. Autonomous build: frontend exec (sonnet) + tests
(haiku) + orchestrator verification.

## Frontend (exec: sonnet)
- `components/SolveProgressChart.tsx` (new) — pure `buildChartModel(solves)` +
  presentational `SolveProgressChart`. Inline SVG (fixed viewBox, `width:100%`,
  fixed aspect so dots stay round). Sorts by `created_at` asc (NaN-safe → index
  fallback); valid-only vertices (`status==="valid"`); PB = min valid time (first
  on ties) marked with a larger `var(--warning)` ring + `<title>Личный рекорд`;
  non-valid (dnf/rejected/unknown) render as `var(--danger)` baseline ticks with
  `<title>DNF`, and BREAK the polyline into segments. Empty / zero-valid →
  placeholder card (History empty-state style, Link `/solo`).
- `pages/ProfilePage.tsx` — «Прогресс времени» section mounted inside History's
  `kind==="ok"` branch, above the empty-check/table, fed by the SAME loaded
  `state.solves` — **no new fetch** (`listSolves` still called once). Caption «за
  последние сборки» (window ≤50), no «verified» copy.

Design tokens (raw SVG presentation attrs for correctness): `var(--primary)`
line/dots, `var(--warning)`+`var(--ink)` PB, `var(--danger)` DNF + outlier
marker, `var(--line)` baseline, `var(--muted)` labels, `var(--surface)` fills.
Theme-aware, no emoji/gradients, no charting lib, `package.json` unchanged.

### Accepted deviation (build-time, correct)
Plan prose said outliers pin to the "top edge". Implementation pins them to the
**slow/bottom edge** — because the Y-axis is inverted ("faster is higher", small
y = top), so a 300 s fumble belongs at the BOTTOM; pinning it to the top would
render the worst solve as the best. Outlier gets `pinned:true`, y clamped to the
slow-domain edge, drawn with a distinct triangle marker + real-time `<title>`;
the fast (top) edge is NOT stretched to the outlier. X-axis = evenly-spaced
index over the FULL sorted window (valid + non-valid) so a DNF occupies its real
slot and the line visibly breaks there. Skeptic MED (outlier robustness)
satisfied via `top = min(max(valid), p95(valid)*1.1)`.

## Tests (haiku) + orchestrator verification
- `tests/profile/SolveProgressChart.test.tsx` (15) — pure `buildChartModel`:
  sort-by-created_at; PB = min valid (ties→first, never dnf/rejected); dnf AND
  rejected excluded from vertices; non-valid between two valids splits the
  polyline; unparseable created_at → index fallback (no throw); outlier →
  `pinned` at slow edge, domain fast-edge not stretched; single valid → no line /
  mid-height dot; all-non-valid → zero valid. RTL: `<svg>` + `<polyline>` + PB by
  title «Личный рекорд»; `solves=[]` → placeholder (link `/solo`), no `<svg>`;
  all-dnf → placeholder; DNF as baseline markers (title «DNF»), not vertices.
- `tests/pages/ProfilePage.test.tsx` (extended) — valid+dnf mix → both the
  «Прогресс времени» heading and the History table render; `listSolves` called
  exactly ONCE.

Orchestrator-run verification:
- `vitest` **398 passed** (41 files; +16 new); `tsc` clean; `eslint` clean.
- `git diff --stat package.json package-lock.json` empty → zero new deps.

## Open / not covered
- Live browser view (needs real solve history + running app) — logic + rendering
  are unit/RTL-verified.
- Window = last ≤50 solves (History's fetch); full-history pagination is
  out-of-scope (labeled «за последние сборки»). PB shown is PB-within-window.
- No event/cube filter — `SolveRead` has no `event` field; deferred.
