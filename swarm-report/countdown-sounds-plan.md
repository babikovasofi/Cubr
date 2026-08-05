# Plan: Звуки отсчёта дуэли (countdown-sounds)   (slug: countdown-sounds)

## TL;DR
StackMat-style synthesized countdown beeps (Web Audio API — no asset files, no
new dep) on the **duel** server countdown: a short tick on each remaining
whole-second boundary + a distinct go-tone at `serverStartAt`, scheduled
sample-accurately via `osc.start(when)` off `AudioContext.currentTime` (never
`setTimeout+play`). A localStorage-persisted mute toggle on the countdown
overlay; one shared lazily-created AudioContext resumed on a real user gesture.
Frontend-only, read-only. **Solo is OUT of scope** — it has no fixed countdown
(its timer starts on camera hand-release, not a timed 3-2-1).

**Skeptic returned `revise` (2 HIGH); both resolved.** HIGH#1 (autoplay: the
server-driven countdown arrives with no fresh gesture, so a lazily-created
context stays `suspended` and nothing plays) → one shared module AudioContext +
`installAudioUnlock()` idempotent one-time `pointerdown`/`keydown`/`touchstart`
document listeners mounted by DuelPage, which `resume()` on the ritual's own
earlier clicks; the scheduler additionally SKIPS silently if `ctx.state !==
"running"`. HIGH#2 (solo has no countdown) → dropped, duel-only. Plus MEDs:
map-to-currentTime-once + skip-past scheduling; effect keyed on `serverStartAt`
(StrictMode/reconnect-safe, cleanup stops nodes); guarded localStorage.

## Acceptance criteria
- During a duel `countdown` phase, an audible short tick fires on each remaining
  whole-second boundary and a distinct go-tone at the `serverStartAt` instant,
  scheduled via `osc.start(when)` off `AudioContext.currentTime`.
- Beeps stop immediately (no orphaned/late tones) if the overlay unmounts or the
  phase leaves `countdown` before start (opponent_left/disconnected).
- A mute/unmute toggle is visible on the countdown overlay; state persists across
  reloads via localStorage (`cubr_countdown_muted`); muted → total silence, zero
  nodes scheduled. Default = UNMUTED.
- AudioContext is lazily created and resumed on a real user gesture; a browser
  with no `AudioContext`/no `window` (SSR) → silent no-op, no throw. If the
  context is still `suspended` at countdown time → skip silently (visual
  countdown unaffected).
- React StrictMode double-mount does NOT double-schedule (effect cleanup runs
  between mounts) and does NOT stack duplicate unlock listeners (idempotent).
- Solo ritual is NOT touched. No backend/migration; §П5/honesty untouched.
- tsc / eslint clean; all frontend tests green.

## Plan
- **`duel/countdownSound.ts`** (new) — Web Audio module:
  - `getAudioContext(): AudioContext | null` — module singleton, lazily built from
    `window.AudioContext ?? (window as {webkitAudioContext?}).webkitAudioContext`
    (narrow cast, no global aug file); `null` when `typeof window==="undefined"`
    or neither exists. Never `close()`d (reused across countdowns/rematches).
  - `installAudioUnlock(): void` — idempotent (module flag); adds one-time
    `{pointerdown,keydown,touchstart}` document listeners (`{once:true}`) that call
    `ctx.resume()` and self-remove. Calling twice adds no duplicate listeners.
  - `scheduleCountdownBeeps(serverStartAt: string): () => void` —
    `msUntilStart = Date.parse(serverStartAt) - Date.now()`; return a noop when
    muted, `ctx` null, `ctx.state !== "running"`, or `msUntilStart <= 0`. Else
    `startAt = ctx.currentTime + msUntilStart/1000`; tick at `startAt - k` for each
    integer `k` in `1..n` where `startAt - k > ctx.currentTime`; go-tone at
    `startAt`. Each beep = fresh `OscillatorNode → GainNode → destination` with a
    short attack/exp-decay envelope (no clicks); `osc.start(when)` / `osc.stop(when
    + dur)`. Returns a cleanup that `stop()`+`disconnect()`s EVERY created node
    (idempotent — safe to call twice).
  - Tones: tick ≈ 1000 Hz, ~0.06 s; go distinctly different (≈ 1760 Hz, ~0.15 s)
    so the start is unmistakable vs the ticks.
  - `isCountdownMuted(): boolean` / `setCountdownMuted(muted): void` — localStorage
    key `cubr_countdown_muted`, `typeof localStorage==="undefined"` + try/catch
    guarded (mirror `src/auth/onboarding.ts`); default unmuted; bad value → default.
- **`duel/DuelRoom.tsx`** (CountdownOverlay) — add a `useEffect` keyed on
  `[serverStartAt, muted]` that, when not muted, calls
  `scheduleCountdownBeeps(serverStartAt)` and runs the returned cleanup on
  unmount / dep-change. Render a small mute toggle button in the overlay wired to
  `isCountdownMuted`/`setCountdownMuted` with a local `useState` mirror so the
  icon/label + `aria` re-render. The existing 100 ms visual `setInterval`
  countdown stays untouched — audio is independent.
- **`pages/DuelPage.tsx`** — call `installAudioUnlock()` once in a mount
  `useEffect`, so the shared context resumes on the first in-app gesture (the
  ritual's own prep clicks) well before the overlay renders.

## Test plan
Full frontend coverage. haiku authors exactly these.

### `tests/duel/countdownSound.test.ts` (node env; `vi.stubGlobal` a fake AudioContext)
- Fake `AudioContext` exposing `currentTime` + `state:"running"` +
  `createOscillator`/`createGain` returning spy nodes (start/stop/connect/
  disconnect, settable `frequency.value`); freeze `Date.now`. For `serverStartAt`
  ~3 s ahead: exactly the expected tick oscillators + ONE go-tone; `osc.start`
  called with `when == ctx.currentTime + msUntilStart/1000 - k` per second and go
  at `startAt` (float tolerance).
- go-tone frequency differs from tick frequency.
- muted → schedules NO nodes, returns noop.
- `msUntilStart <= 0` (serverStartAt in the past) → no nodes, noop.
- `ctx.state === "suspended"` → no nodes scheduled (skip silently).
- no `AudioContext` on window → `getAudioContext()===null`, scheduler no-throw no-op.
- cleanup() stops+disconnects every created node exactly once; safe to call twice.
- mute persistence: default `isCountdownMuted()===false`; `setCountdownMuted(true)`
  → `true`; `localStorage` undefined → both guarded no-ops (Map-stub per
  `onboarding.test.ts`, restore in afterEach).
- `installAudioUnlock`: a `pointerdown` → `ctx.resume()` once; second install +
  gesture adds no duplicate resume (idempotent); listener removed after first fire.

### `tests/duel/DuelRoom.test.tsx` (jsdom, extend; `vi.mock ../../src/duel/countdownSound`)
- `phase==="countdown"` with scramble + serverStartAt → `scheduleCountdownBeeps`
  called once with that serverStartAt; unmount / phase-change → cleanup invoked.
- Mute toggle button present in the overlay; click flips `setCountdownMuted` and
  the button label/`aria` reflects state (and muted → no schedule).

## Blockers
None — both skeptic HIGH resolved (gesture-unlocked shared context + `state==="running"`
guard; solo dropped), MEDs (currentTime-mapped skip-past scheduling, serverStartAt-keyed
StrictMode-safe effect + node cleanup, guarded localStorage) baked in. Proceed to /build.

## Out of scope
- Solo ritual (no fixed countdown; timer starts on hand-release).
- Any audio asset file or new npm dep (howler/tone/etc.) — Web Audio synthesis only.
- Server clock sync / true ms-lockstep (countdown already trusts the client clock,
  same as the existing visual overlay).
- A global app-wide audio/settings surface beyond the overlay mute toggle.
- Beeps on any non-countdown transition (start reveal, result, opponent_left).

## Assumptions
- WS `countdown` carries `server_start_at` as a future ISO (~3 s ahead), already
  threaded into CountdownOverlay as `state.serverStartAt` (confirmed:
  useDuelSocket `WireCountdown` + duelMachine `countdown`).
- No existing audio/settings store (grep AudioContext/oscillator/new Audio = none);
  mute lives on the overlay + localStorage, no new settings page.
- Default UNMUTED: sound IS the feature + matches StackMat expectation; it's
  gesture-gated (context suspended until real interaction) and only during an
  actively-entered duel countdown, so not passive autoplay; one-tap mute covers
  opt-out.
- Mute-toggle copy is Russian to match the overlay (e.g. «Звук»/«Без звука» or a
  speaker glyph); exact wording at build.
