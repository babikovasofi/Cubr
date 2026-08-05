# Plan: Соло-флоу фиксы (Block B)   (slug: solo-flow-fixes)

Manual-QA bugs in the solo/tournament/daily calibrate flow. Frontend-only, no
vision-algorithm change (colour accuracy = Block D / R1). Done inline with full
logic test coverage.

## Bugs → root cause → fix
1. **A registered cube is forced to be re-scanned.** With a selected cube the
   calibrate screen only offered the one-white-face quick-adjust (`calibrateStep`
   → `reader.quickAdjust`), so the user had to show the cube again even though
   its colour profile is already stored. But `reader.seedProfile` (run on cube
   selection) already sets `calibrationStep = 6/6`. **Fix:** a new
   `useCalibrate.useSavedProfile()` seeds the stored profile and fires
   `onCalibrated()` immediately — no camera scan — surfaced as a PRIMARY
   «Использовать сохранённый профиль» button in the quick-adjust panel (the
   white-face adjust becomes an optional «подстроить под свет»).
2. **Calibration capture accepts an empty/black frame → «готово».**
   `reader.captureCalibration` was the ONLY sampling path with NO frame gate —
   `quickAdjust`/`pushVerifyFace` both call `readable()` (a `guideRegionLuma`
   check in `[MIN_FRAME_LUMA, MAX_FRAME_LUMA]`), but `captureCalibration` sampled
   whatever was in the guide rect. **Fix:** `captureCalibration` now applies the
   SAME luma gate (minus the refs precondition, which doesn't exist mid-6-face
   build) and returns `boolean`; its callers — solo full-calibration
   (`useCalibrate`) and the cube-register wizard (`useCubeRegister`) — show
   «не вижу грань» and DON'T advance on `false`. Note: the luma gate stops
   dark/no-signal frames but can't distinguish a solved face from a well-lit
   empty surface — that deeper presence check is R1 (needs the `/accuracy` data).

## Acceptance criteria
- With a registered cube selected, the calibrate screen offers a primary
  «Использовать сохранённый профиль» that advances to the scramble with NO scan;
  the white-face quick-adjust stays available as a secondary option.
- `useCalibrate.useSavedProfile()` seeds the stored profile and calls
  `onCalibrated()`; it is a no-op when no cube/profile is selected.
- A full-calibration capture on an unreadable (empty/too-dark) frame does NOT
  advance the 1/6..6/6 counter and shows the unreadable error; a readable capture
  advances. Same gate applies to the cube-register wizard.
- No vision algorithm / colour classification changed; `captureCalibration`
  reuses the already-tuned `MIN/MAX_FRAME_LUMA` thresholds.
- tsc / eslint clean; all frontend tests green.

## Affected files
- `vision/hooks/useCubeReader.ts` — `captureCalibration` → `boolean`, luma-gated.
- `solo/useCalibrate.ts` — handle the `false` capture (error, no advance); add
  `useSavedProfile()`; expose it on `CalibrateApi`.
- `cubes/useCubeRegister.ts` — `capture()` handles `false` → `faceUnreadableRu()`.
- `solo/useSoloSession.ts` — expose `useSavedProfile` on `SoloSession`.
- `solo/SolveRitual.tsx` — quick-adjust panel: primary skip button + secondary adjust.
- `tests/tournament/TournamentPage.test.tsx` — stub gains `useSavedProfile`.

## Test plan
- `tests/solo/useCalibrate.test.ts` (new) — `useSavedProfile` seeds + advances;
  no-op without a selected profile; full-calibration `captureCalibration()===false`
  → error + no advance; `===true` (+profile) → advance, no error.
- Manual QA (hardware): selecting a registered cube skips the scan; an empty-frame
  capture is rejected with a clear message. (Colour-recognition accuracy itself
  is Block D / the `/accuracy` gate.)

## Out of scope
- Colour classification / angle-invariant matching quality (Block D / R1).
- Distinguishing a solved face from a well-lit empty surface (R1 presence detection).
- Backend / settings.

## Assumptions
- Using the stored profile without a live adjust is `validated=false` (casual),
  same posture as quick-adjust — acceptable per the user's explicit "don't force
  re-scan" request.
- The existing `MIN/MAX_FRAME_LUMA` thresholds are reused as-is; tuning them for
  presence is deferred to the `/accuracy`-driven R1 work.
