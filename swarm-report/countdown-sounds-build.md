# Build report: Звуки отсчёта дуэли (slug: countdown-sounds)

Status: **implementation complete, tests green, ready for /review.**
Frontend-only, read-only, duel-only. Autonomous build: frontend exec (sonnet)
authored feature + the full plan Test plan → orchestrator verified. The separate
haiku tester step was SKIPPED as redundant (the exec agent's suite implements
every test the plan lists, all green; coverage verified below).

## Frontend (exec: sonnet)
New:
- `duel/countdownSound.ts` — Web Audio module, no assets, no dep:
  - `getAudioContext()` — module singleton from `window.AudioContext ??
    (window as {webkitAudioContext?}).webkitAudioContext`; null when
    window/AudioContext absent; never `close()`d.
  - `installAudioUnlock()` — idempotent (`unlockInstalled` flag); one-time
    `{pointerdown,keydown,touchstart}` `{once:true}` document listeners →
    `ctx.resume()` + self-remove. StrictMode-safe (repeat calls no-op).
  - `scheduleCountdownBeeps(serverStartAt)` — `msUntilStart = Date.parse(...) -
    Date.now()`; noop when muted / ctx null / `ctx.state !== "running"` /
    `msUntilStart <= 0`. Else `startAt = ctx.currentTime + msUntilStart/1000`;
    tick osc per whole second `startAt-k > ctx.currentTime` (MAX_TICKS=10 safety
    bound), distinct go-tone at `startAt`. Fresh `OscillatorNode → GainNode →
    destination`, envelope `setValueAtTime(0)→linearRamp(0.3,+5ms)→expRamp(1e-4,
    +dur)` (no click). Returns an idempotent cleanup that stop()+disconnect()s
    every node.
  - `isCountdownMuted()`/`setCountdownMuted()` — localStorage `cubr_countdown_muted`,
    `typeof localStorage==="undefined"` + try/catch guarded (mirrors
    `auth/onboarding.ts`, plus try/catch per plan); default unmuted.
  - Tones: tick 1000 Hz / 0.06 s, go 1760 Hz / 0.15 s (distinct).
- Modified:
  - `duel/DuelRoom.tsx` (CountdownOverlay) — scheduling `useEffect`
    keyed on `[serverStartAt, muted]` (schedule when unmuted, cleanup on
    unmount/dep-change); mute toggle button (absolute top-right, `aria-pressed` +
    `aria-label` «Включить/Выключить звук отсчёта», inline currentColor SVG
    speaker glyph — no emoji, no new icon dep), local `useState` mirror of
    `isCountdownMuted()`. The existing 100 ms visual `setInterval` countdown is
    untouched — audio is independent.
  - `pages/DuelPage.tsx` — `installAudioUnlock()` in a mount `useEffect` so the
    shared context resumes on the ritual's own earlier gesture, before the
    overlay renders.

Skeptic resolutions verified: shared context + gesture unlock + `state==="running"`
guard (HIGH#1); solo dropped (HIGH#2); currentTime-mapped skip-past scheduling
(MED); serverStartAt-keyed effect + node cleanup on early exit (MED); guarded
localStorage (MED); default-unmuted gesture-gated (LOW).

## Tests + orchestrator verification
Suite (authored by exec agent, matches plan Test plan):
- `tests/duel/countdownSound.test.ts` (9) — fake AudioContext (currentTime, state,
  spy osc/gain nodes): correct tick count + one distinct go-tone with `osc.start`
  `when` == `currentTime + msUntilStart/1000 - k`; go freq ≠ tick freq (1760 vs
  1000); muted → no nodes; past `serverStartAt` → no nodes; `state==="suspended"`
  → no nodes; no AudioContext → null + no-throw no-op; cleanup stops+disconnects
  each node once, safe twice; mute persistence (default false, set→true,
  localStorage-undefined guarded); `installAudioUnlock` resumes once per gesture,
  idempotent, `{once}` removal.
- `tests/duel/DuelRoom.test.tsx` (extended) — countdown phase → `scheduleCountdownBeeps`
  called once with serverStartAt; unmount/phase-change → cleanup invoked; mute
  toggle present, click flips `setCountdownMuted` + aria reflects state.

Orchestrator-run verification:
- `vitest` **429 passed** (46 files); `tsc` clean; `eslint` clean.
- `git diff --stat package.json package-lock.json` empty → zero new deps.

Test-authoring note (flagged by exec agent): mocking `window.AudioContext` with
an arrow-fn `vi.fn()` throws under `new` (arrows aren't constructible) — a
function-expression mock is required. Not a source bug.

## Open / not covered
- Live browser audio (actual beeps + gesture unlock + tab-throttling behavior) —
  needs a real browser + AudioContext; jsdom has none, so logic is unit-tested
  against a mocked graph.
- Duel-only (solo has no fixed countdown — confirmed in `soloPhase.ts`).
- Countdown trusts the client clock (same as the existing visual overlay); no
  server clock sync.
