# Plan: Онбординг/регистрация — камера-баги (Block A)   (slug: onboarding-camera-fixes)

Manual-QA bugs in the onboarding camera-check + cube-register wizard. Frontend-only,
no backend/vision-algorithm change (that's Block D / R1). Done inline (subagent
session limit hit) with full logic test coverage + self-review.

## Bugs → root cause → fix
1. **Onboarding «Проверка камеры» declares ready without hands actually present.**
   `OnboardingPage.CameraStep`: `ready = cam.started && cam.handsSeen`, but
   `useCameraCheck` latches `handsSeen` on the FIRST frame where
   `obs.handsDetected` (`if (obs.handsDetected) setHandsSeen(true)`) — a
   one-way latch with NO debounce and NO reset. A single spurious detector frame
   (or a transient) sticks "ready" forever even with no hands on the table.
   **Fix:** latch `handsSeen` only after hands are detected for a SUSTAINED run
   of consecutive frames (`HANDS_CONFIRM_FRAMES`); a frame with no hands resets
   the run. Extract a pure `advanceHandsGate(run, detected, threshold)` for unit
   tests. Also expose a `starting` state (camera clicked, no frame yet) so the UI
   shows «Запускаю камеру…» instead of jumping to a hands prompt.
2. **Camera preview is tiny.** `OnboardingPage` wraps everything in `max-w-2xl`
   (32rem); the cube-register step renders `CubeRegisterWizard`'s
   `md:grid-cols-[minmax(0,1fr)_20rem]` grid INSIDE that → the camera column is
   ~12rem = tiny. **Fix:** widen the onboarding container on the camera steps
   (step 1 «Проверка камеры» + step 2 «Регистрация») to `max-w-5xl`, and give
   `CameraStage` a sensible `min-h` so it never collapses. Keep the intro step
   narrow.
3. **Color-profile swatches look clickable but do nothing.** In the wizard's
   «Сохранить кубик» step, `<span>Цвет-профиль</span> + <ColorPalette>` renders a
   READ-ONLY preview of the auto-captured profile (6 face swatches, no `onClick`).
   The user clicked expecting to pick a colour — there is nothing to pick (the
   profile is derived from the 6 captured faces). **Fix:** relabel to make it
   unmistakably a preview («Так Cubr запомнил твой кубик» + a one-line hint
   «Профиль снят автоматически с 6 граней — выбирать ничего не нужно»); give the
   swatches a non-interactive affordance (`cursor-default`, decorative aria) so
   they don't read as buttons. No functional picker is added.

## Acceptance criteria
- Onboarding «Проверка камеры» shows «Далее» enabled ONLY after hands are
  detected for `HANDS_CONFIRM_FRAMES` consecutive frames; a single spurious
  detected frame does NOT enable it; losing hands mid-run resets the run so a
  later sustained run is what confirms. The «Пропустить (камера не проверена)»
  escape hatch stays.
- Between clicking «Включить камеру» and the first frame, the UI shows a
  «Запускаю камеру…» state, not «Ищу руки».
- The camera preview on the onboarding camera + cube-register steps is visibly
  larger (container `max-w-5xl`, CameraStage `min-h`), the intro step unchanged.
- The «Сохранить кубик» step labels the swatches as an auto-captured preview with
  a hint that nothing is selectable; swatches are not interactive.
- `advanceHandsGate` is a pure, unit-tested function; no vision algorithm / no
  backend touched; §П5 irrelevant (no writes).
- tsc / eslint clean; all frontend tests green.

## Affected files
- `frontend/src/onboarding/useCameraCheck.ts` — sustained-hands debounce via a
  run-ref + exported pure `advanceHandsGate`; add `starting` to the returned
  state; set it on `start()` before the first frame, clear on first frame.
- `frontend/src/pages/OnboardingPage.tsx` — widen container for steps 1–2
  (`max-w-5xl`), narrow for intro; «Запускаю камеру…» copy from `cam.starting`;
  keep `ready` gate (now debounced upstream).
- `frontend/src/solo/CameraStage.tsx` — add a `min-h` (e.g. `min-h-[18rem]`) so
  the preview never collapses in a narrow column. (Shared with solo/duel — a
  min-height is safe there too; verify no regression.)
- `frontend/src/cubes/CubeRegisterWizard.tsx` — relabel the «Цвет-профиль» block
  to an auto-preview with the hint; pass a `readOnly`/decorative flag if needed.
- `frontend/src/cubes/ColorPalette.tsx` — `cursor-default`, `aria-hidden` on the
  decorative swatch list wrapper (or keep the aria-label but ensure not
  button-like); no onClick added.

## Test plan (full logic coverage; camera pixels are manual QA)
- `frontend/tests/onboarding/useCameraCheck.test.ts` (new) —
  `advanceHandsGate`: below-threshold consecutive detected → not seen; exactly
  `HANDS_CONFIRM_FRAMES` consecutive → seen; a not-detected frame mid-run resets
  the run (so a single detected frame never latches); once seen, stays seen
  (latch after confirmation).
- `frontend/tests/pages/OnboardingPage.test.tsx` (new or extend) — mock
  `useCameraCheck`: `starting` → «Запускаю камеру…»; `started && !handsSeen` →
  «Ищу руки…» + «Далее» disabled + skip-hatch visible; `ready` → «Далее» enabled;
  container has the wide class on camera steps.
- `frontend/tests/cubes/CubeRegisterWizard.test.tsx` (new or extend) — the save
  step renders the auto-preview label + hint; the swatches are not buttons (no
  role=button / no onClick); ColorPalette renders 6 swatches from the profile.
- Manual QA (hardware): real camera — «готово» only fires with hands genuinely
  in frame; preview is comfortably large; the save-step copy reads as a preview.

## Out of scope
- Any vision algorithm / colour recognition / angle-invariant matching (Block D / R1).
- The solo capture-with-no-cube gate + skip-rescan (Block B).
- Backend / settings time-format (Block C).

## Assumptions
- `HANDS_CONFIRM_FRAMES` ≈ 8 (~0.25–0.5s at typical detector cadence) — enough to
  reject a spurious frame, short enough to feel instant. Tune in manual QA.
- Widening onboarding to `max-w-5xl` is acceptable within the app shell; the
  intro step stays visually calm.
- CameraStage `min-h` does not regress solo/duel layouts (they already give it a
  full-width column); verified via existing tests + tsc.
