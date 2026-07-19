# Plan: График прогресса времён сборок (progress-graph)   (slug: progress-graph)

## TL;DR
Frontend-only solve-time progress line chart on ProfilePage — `time_ms` of
VALID solves over `created_at`, from the SAME `listSolves(50,0)` data History
already fetches (no second request, no endpoint, no migration, no new dep).
Inline SVG using project design tokens (theme-aware). PB marked (min valid time
in the window). DNF/rejected excluded from the line (shown as baseline ticks,
never as vertices). Robust Y-domain (p95 clamp, outliers pinned) so one fumble
doesn't flatten the line. Empty/degenerate states handled. Read-only; §П5
untouched.

**Skeptic returned `revise` (3 HIGH); all resolved.** HIGH#1 (GET /solves capped
50, paginated DESC — «full history» impossible from one call) → chart reuses
the existing 50-row window, sorts to chronological, labeled «за последние
сборки» (never «вся история»); no pagination added. HIGH#2 (no `event` field in
SolveRead, `cube_id` is a bare UUID) → per-event/per-cube filter DROPPED (would
need backend). HIGH#3 (status ∈ {valid, dnf, rejected}) → line includes ONLY
`status==="valid"`; dnf AND rejected AND any unknown status excluded. MED (DNF
has a real positive `time_ms`, not null) → filter by STATUS only, never by
`time_ms` falsiness. MED (Y outliers) → p95-clamped domain with pinned outliers
(merge addition below). Data confirmed: `created_at` is present (ISO string), so
the date/order X-axis is genuinely pure-frontend.

## Acceptance criteria
- ProfilePage renders a new «Прогресс времени» section (between BadgeGrid and the
  History table) sourced from the SAME `listSolves(50,0)` History already loads —
  assert `listSolves` is called exactly ONCE; no new network request/endpoint.
- Chart is inline `<svg>` (no charting library, `package.json` unchanged); a
  `<polyline>` per segment connects consecutive VALID solves ordered by
  `created_at` ascending; Y = `time_ms` (seconds, inverted — faster is higher),
  X = evenly-spaced index order.
- PB (min `time_ms` among `status==="valid"`, first occurrence on ties) is
  marked distinctly (larger dot + `var(--warning)` ring + `<title>Личный рекорд:
  X.XX с</title>`), and is always a valid solve.
- Non-valid solves (`status !== "valid"`, i.e. dnf/rejected/unknown) do NOT
  become line vertices: the polyline BREAKS into segments around them; they
  render as small `var(--danger)` baseline ticks with `<title>DNF</title>`.
- Y-domain is outlier-robust: top = min(maxValid, p95(valid) with small
  headroom); valid points above the domain top are PINNED to the top edge and
  drawn with a distinct marker + `<title>` showing the real time (so a 300s
  fumble doesn't flatten the rest). For small N, p95≈max → graceful min–max.
- Empty state: `solves.length===0` OR zero VALID points → tidy placeholder card
  (matches History empty-state: `border border-line bg-surface`, muted body,
  Link to `/solo`) — NO empty/broken `<svg>`. A non-empty history with 0 valid
  points still shows this placeholder.
- Loading/error reuse History's Spinner + error+retry (chart shares History's
  fetched state; hidden until `kind==="ok"`).
- Colors use ONLY project tokens (`var(--primary)` line, `var(--warning)` PB,
  `var(--danger)` DNF, ink/muted/line/surface); no purple gradient, no emoji, no
  charting-lib default look; light + dark both work via CSS-var tokens.
- Copy is neutral personal history — NO «verified»/«official»/«подтверждено»
  wording. Section labeled «за последние сборки» (window ≤50), never «вся история».
- §П5 PB-invariant and all backend behavior untouched; read-only.
- tsc / eslint clean; all frontend tests green.

## Plan
- **`components/SolveProgressChart.tsx`** (new) — pure presentational
  `SolveProgressChart({ solves }: { solves: SolveRead[] })`. Exports a pure
  `buildChartModel(solves)` for unit tests:
  - Sort ALL solves by `new Date(created_at).getTime()` ascending; `NaN` parse →
    stable fallback to input index (never throws).
  - `validPoints = solves.filter(s => s.status === "valid")` (in sorted order).
  - `pb = ` point with min `time_ms` among validPoints (first on ties).
  - Y-domain: `minY = min(validTimes)`; `p95 = percentile(validTimes, 95)`;
    `maxY = min(max(validTimes), p95 * 1.1)`. Points with `time_ms > maxY` flagged
    `pinned=true` (y clamped to top edge). If all equal / single point, domain is
    a small symmetric band so the dot sits mid-height.
  - Map to SVG viewBox coords (fixed e.g. `0 0 320 160`, padding for axis
    labels); y inverted (lower time → higher). X = index across plot width
    (evenly spaced — documented choice; avoids same-day clustering).
  - `segments`: split the valid polyline so a non-valid solve BETWEEN two valids
    breaks the line (no interpolation across the gap).
  - `dnfMarkers`: non-valid solves at their x-position on the baseline.
  - Each valid point carries `title = "${fmtMs(time_ms)} · ${fmtDate(created_at)}"`.
  - Render: `<polyline>` per segment `stroke=var(--primary) fill=none`; `<circle>`
    per valid point (small, `fill=var(--surface) stroke=var(--primary)`); PB
    circle larger + `stroke=var(--warning)` + title; pinned-outlier marker
    distinct; DNF baseline ticks `stroke=var(--danger)` + title; min/max Y
    gridline labels (seconds, `tabular-nums`, `text-muted`) + first/last date X
    labels. `width:100%`, fixed aspect so dots stay round (draw in viewBox units,
    only CSS scales width).
  - Small local `fmtMs`/`fmtDate` (mirror ProfilePage's; keep local to avoid
    churn — 2 tiny fns).
  - Empty/degenerate → placeholder card instead of `<svg>`.
- **`pages/ProfilePage.tsx`** — inside History's `kind==="ok"` branch, render a
  `<section>` «Прогресс времени» (`<h2 text-h3>` + caption «за последние сборки»)
  with `<SolveProgressChart solves={state.solves} />` ABOVE the existing
  empty-check/table, so the ONE existing fetch feeds both. Loading/error branches
  unchanged (chart hidden until ok). Import the component. No new fetch.

## Test plan
Full frontend coverage. haiku test agent authors exactly these.

### `tests/profile/SolveProgressChart.test.tsx` (pure `buildChartModel` + RTL, `// @vitest-environment jsdom`)
- pure: mixed-order solves sorted by `created_at` ascending regardless of input order.
- pure: PB = min `time_ms` among `valid`; ties → first occurrence; PB never a DNF/rejected.
- pure: `dnf` AND `rejected` excluded from valid points; a non-valid solve
  between two valids splits the polyline into 2 segments (no vertex, no
  cross-gap connection).
- pure: unparseable `created_at` → index-order fallback, no throw (NaN-safe).
- pure (outlier): a single huge outlier does NOT stretch the domain — it's
  `pinned` (y at top edge) and the domain top ≈ p95, not the outlier value.
- pure (degenerate): single valid point → no polyline segment (or one 0-length),
  a single dot; all-non-valid → zero valid points.
- RTL: valid solves → renders `<svg>` with ≥1 `<polyline>` and a PB element
  queryable by title «Личный рекорд».
- RTL: `solves=[]` → placeholder card (empty copy + link `href="/solo"`), NO `<svg>`.
- RTL: all-DNF/rejected → placeholder (no valid points), no polyline.
- RTL: DNF solves render as baseline markers (title «DNF»), NOT as line vertices.

### `tests/pages/ProfilePage.test.tsx` (extend existing)
- `listSolves` mocked to a valid+dnf mix → BOTH the «Прогресс времени» heading
  and the History table render, and `listSolves` is called exactly ONCE (one
  fetch feeds both).

## Blockers
None — all 3 skeptic HIGH resolved (window-scoped honest label; event/cube
filter dropped for lack of data; valid-only line), MED (status-based filter,
p95 outlier clamp) + LOWs (design tokens/dark theme, no verified copy, in-window
PB) baked in. Proceed to /build.

## Out of scope
- Any backend/endpoint/migration (reuse GET /solves as-is).
- New npm dependency / charting library.
- event filter (no `event` field in SolveRead); cube filter (needs cubesStore
  name lookup + UI state — deferred).
- Ao5/rolling-average, multi-series, zoom/pan/custom tooltips beyond native `<title>`.
- Full-history / all-time window beyond the fetched 50 solves (pagination loop —
  future).
- Any write path or §П5 change (read-only).

## Assumptions
- `SolveRead` has `time_ms:number`, `status:string`, `created_at:string(ISO)`,
  `cube_id:string|null`, `id` — NO `event`, NO per-solve best. Verified in
  `frontend/src/api/solves.ts`. → event filter impossible; PB computed
  client-side; X uses `created_at`.
- `listSolves(50,0)` window (recent ≤50 solves) is the data source, reused from
  History's single fetch. PB shown = PB-within-window (may differ from all-time
  `user.best_single_ms`) — labeled «за последние сборки» to not imply all-time.
- `valid` is the only line-eligible status; `dnf`/`rejected`/unknown are non-valid.
- No inline-SVG chart house style exists (only canvas in `solo/CameraStage`) →
  this component sets the pattern; still obeys design tokens + anti-slop.
- X spacing is index-based (evenly spaced), documented — avoids same-day cluster.
