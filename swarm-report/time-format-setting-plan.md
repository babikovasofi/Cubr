# Plan: Настройка формата времени (Block C)   (slug: time-format-setting)

Manual-QA request: let the user choose how solve times are shown — plain seconds
(`12.34`, `83.45`) or clock (`1:23.45`, plain under a minute) — persisted, applied
everywhere a solve time is shown. Frontend-only, read-only, no backend. Done inline.

## Decision
- Two formats: `seconds` (always total seconds, 2 decimals) and `clock`
  (minutes:seconds when ≥60 s, plain seconds under a minute — standard cubing).
- Default `clock` (most familiar). Persisted in localStorage (`cubr_time_format`),
  guarded like `store/cubesStore.ts` (`globalThis.localStorage?.`).
- One pure formatter `formatSolveMs(ms, format)` + a zustand `settingsStore` so
  every display reacts to a change. Countdown/deadline labels (mm:ss) and the
  live coarse guide readout stay as-is (not final solve times).

## Formatter (pure, `lib/formatTime.ts`)
```
type TimeFormat = "seconds" | "clock";
formatSolveMs(ms, format):
  cs = max(0, round(ms/10))            // centiseconds, one rounding basis
  totalSec = cs/100
  if format==="seconds"        -> totalSec.toFixed(2)      // 83.45
  if cs < 6000                 -> totalSec.toFixed(2)      // clock, under min: 12.34
  min = floor(cs/6000); sec = (cs-min*6000)/100
  -> `${min}:${sec.toFixed(2).padStart(5,"0")}`            // 1:03.05, 10:00.00
```

## Affected files
- `src/lib/formatTime.ts` (new) — `TimeFormat`, `formatSolveMs`.
- `src/store/settingsStore.ts` (new) — zustand `{ timeFormat, setTimeFormat }`,
  init from localStorage (default `clock`), guarded persist. Mirror `cubesStore`.
- Call sites (read `useSettingsStore((s)=>s.timeFormat)`, swap the
  `(ms/1000).toFixed(2)` for `formatSolveMs(ms, fmt)`, keep DNF checks + any « с»):
  - `pages/ProfilePage.tsx` — `fmtMs` (records, Ao5, history).
  - `components/SolveProgressChart.tsx` — `fmtMs` (axis labels, PB title).
  - `tournament/TournamentResult.tsx`, `tournament/TournamentStandings.tsx`.
  - `duel/DuelResult.tsx` (`formatTime` gains a `format` param, passed from the component).
  - `solo/useSoloSession.ts` — the live/result time strings (lines ~451-453).
- `pages/ProfilePage.tsx` — add a «Настройки» section: two radio options
  «Секунды · 12.34» / «Минуты : секунды · 1:23.45» wired to the store.

Out of scope (this block): the uncommitted `daily/*` files (converted when daily
is finished), `guide.ts` live «идёт X с» readout, `TournamentPage`/`DailyPage`
countdown `deadlineLabel` (mm:ss countdown, not a solve time).

## Acceptance criteria
- A «Настройки → Формат времени» control on the profile switches between seconds
  and clock; the choice persists across reloads (localStorage).
- Every committed solve-time display (profile records/Ao5/history, progress chart,
  tournament result/board, duel result, solo live+result) renders in the chosen
  format; changing the setting updates them without reload.
- `formatSolveMs` is pure + unit-tested: seconds mode never shows minutes; clock
  mode shows plain seconds under 60 s and `M:SS.cc` (zero-padded) at/over 60 s.
- localStorage access guarded (private mode/SSR → in-memory default, no throw).
- tsc / eslint clean; all frontend tests green.

## Test plan
- `tests/lib/formatTime.test.ts` — seconds: `1234→12.34`, `83450→83.45`,
  `500→0.50`, `60000→60.00`, `0→0.00`. clock: `1234→12.34`, `59990→59.99`,
  `60000→1:00.00`, `83450→1:23.45`, `63050→1:03.05`, `600000→10:00.00`; rounding
  `59995→1:00.00` (clock) / `60.00` (seconds).
- `tests/store/settingsStore.test.ts` — default `clock`; `setTimeFormat("seconds")`
  updates state + writes localStorage; re-init reads persisted value; localStorage
  undefined → guarded no-throw, default `clock`.
- `tests/pages/ProfilePage.test.tsx` (extend) — the «Формат времени» radios render;
  selecting «Секунды» calls the store setter and a shown record time re-renders in
  seconds format (or assert the store value drives the displayed string).

## Assumptions
- Default `clock` matches cubing timers; the user can switch to seconds.
- No dedicated `/settings` route — the control lives in the existing ProfilePage
  (the account hub). A separate settings page is out of scope.
- No « с» unit churn: components keep their current surrounding text; only the
  numeric core swaps to `formatSolveMs`.
