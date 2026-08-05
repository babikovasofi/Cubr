// Pure phase reducer for the solo solve ritual (§5.1 minus opponent). No DOM, no
// timers — fully unit-testable. The orchestrator (useSoloSession) feeds it actions
// derived from the camera/hands loop and reads back the phase.
//
// Phase order (Part A honest-start reorder):
//   loading → calibrate → walkthrough → verify → armed → solving → stopped
//           → solve_verify → result
//
// CALIBRATE FIRST (plan #7): the SOLVED cube is shown BEFORE the scramble — either
// a one-white-face quick-adjust over a seeded profile, or a full 6-face read for the
// anon/no-profile fallback. `calibrate_ok` is the ONLY exit from calibrate, so the
// timer can never arm without an honest colour baseline taken on a solved cube.
//
// Timer gate (plan #6): `solve_start` only transitions when the phase is "armed"
// (reached via verify_ok, i.e. scrambleVerified). The FSM can never advance into a
// timed solve on an unverified scramble.
//
// HONEST FINISH (plan #7): `solve_stop` freezes the timer into "stopped" (records
// stopT/elapsedMs) — NOT straight to result. The user then confirms the cube is
// actually SOLVED (ground truth = solved facelets, not the scramble target);
// solve_verify_ok reaches "result".
//
// Elapsed timebase: elapsedMs = stopT − startT, both frame timestamps (o.t). Never
// a React tick.

export type SoloPhase =
  | "loading" // generating scramble / loading cubing
  | "calibrate" // NEW first screen: show the SOLVED cube (quick-adjust or 6-face)
  | "walkthrough" // stepping through the scramble
  | "verify" // collecting 6 faces to check the scramble
  | "armed" // scramble verified; FSM may now arm/start the timer
  | "solving" // timer running
  | "stopped" // NEW: timer frozen; awaiting honest finish confirmation
  | "solve_verify" // NEW: collecting the solved-cube confirmation
  | "result"; // fixed time or DNF

export interface SoloState {
  phase: SoloPhase;
  scrambleVerified: boolean;
  startT: number | null;
  stopT: number | null;
  elapsedMs: number;
  mismatch: { face: string; count: number } | null;
  dnf: boolean; // true when the solve ended by abort (detection lost)
  // Demo escape hatch (not a vision fix): true unless the tester used "Пропустить"
  // on either verify screen after repeated camera-read failures. Threaded to the
  // result screen + verify_frames_ok on save so a skipped result is never silently
  // indistinguishable from an honestly camera-verified one.
  cameraVerified: boolean;
}

export const initialSoloState: SoloState = {
  phase: "loading",
  scrambleVerified: false,
  startT: null,
  stopT: null,
  elapsedMs: 0,
  mismatch: null,
  dnf: false,
  cameraVerified: true,
};

export type SoloAction =
  | { type: "scramble_ready" }
  | { type: "calibrate_ok" }
  | { type: "goto_verify" }
  | { type: "back_to_walkthrough" }
  | { type: "verify_ok" }
  | { type: "verify_mismatch"; face: string; count: number }
  | { type: "verify_skip" }
  | { type: "solve_start"; t: number }
  | { type: "solve_stop"; t: number }
  | { type: "goto_solve_verify" }
  | { type: "solve_verify_ok" }
  | { type: "solve_verify_mismatch"; face: string; count: number }
  | { type: "solve_verify_skip" }
  | { type: "abort" }
  | { type: "again" };

// State shared by `again` and the calibrate-first entry: everything reset EXCEPT the
// phase, which lands on "calibrate" (never back to loading — the scramble already
// exists; the caller clears/re-seeds the reader refs so a second solo does not skip
// the honest start with stale refs, plan #7).
const freshCalibrate: SoloState = { ...initialSoloState, phase: "calibrate" };

export function soloReducer(s: SoloState, a: SoloAction): SoloState {
  switch (a.type) {
    case "scramble_ready":
      // Leave the loading gate into the calibrate-first screen; ignore if moved on.
      return s.phase === "loading" ? { ...s, phase: "calibrate" } : s;

    case "calibrate_ok":
      // The ONLY exit from calibrate → the SOLVED cube was shown before the scramble.
      return s.phase === "calibrate" ? { ...s, phase: "walkthrough" } : s;

    case "goto_verify":
      return s.phase === "walkthrough" ? { ...s, phase: "verify", mismatch: null } : s;

    case "back_to_walkthrough":
      return s.phase === "verify"
        ? { ...s, phase: "walkthrough", mismatch: null, scrambleVerified: false }
        : s;

    case "verify_ok":
      return s.phase === "verify"
        ? { ...s, phase: "armed", scrambleVerified: true, mismatch: null }
        : s;

    case "verify_mismatch":
      // Stay in verify; the timer stays un-armed (scrambleVerified false).
      return s.phase === "verify"
        ? { ...s, scrambleVerified: false, mismatch: { face: a.face, count: a.count } }
        : s;

    case "verify_skip":
      // Demo escape hatch: arm the timer WITHOUT an honest camera verification.
      // cameraVerified:false rides through to the result + verify_frames_ok.
      return s.phase === "verify"
        ? { ...s, phase: "armed", scrambleVerified: true, cameraVerified: false, mismatch: null }
        : s;

    case "solve_start":
      // GATE: never start timing unless armed + verified.
      return s.phase === "armed" && s.scrambleVerified
        ? { ...s, phase: "solving", startT: a.t, stopT: null, elapsedMs: 0 }
        : s;

    case "solve_stop":
      // Freeze the timer into "stopped" — NOT result. Honest finish comes next.
      return s.phase === "solving" && s.startT !== null
        ? {
            ...s,
            phase: "stopped",
            stopT: a.t,
            elapsedMs: a.t - s.startT,
            dnf: false,
            mismatch: null,
          }
        : s;

    case "goto_solve_verify":
      return s.phase === "stopped" ? { ...s, phase: "solve_verify", mismatch: null } : s;

    case "solve_verify_ok":
      // Ground truth = SOLVED facelets (checked by the caller). Accept from either
      // the stopped screen or the active solve_verify collector.
      return s.phase === "stopped" || s.phase === "solve_verify"
        ? { ...s, phase: "result", mismatch: null }
        : s;

    case "solve_verify_mismatch":
      // Cube isn't actually solved — stay put and record the discrepancy.
      return s.phase === "stopped" || s.phase === "solve_verify"
        ? { ...s, mismatch: { face: a.face, count: a.count } }
        : s;

    case "solve_verify_skip":
      // Demo escape hatch: reach "result" WITHOUT an honest camera confirmation
      // that the cube is actually solved. cameraVerified:false rides through.
      return s.phase === "stopped" || s.phase === "solve_verify"
        ? { ...s, phase: "result", cameraVerified: false, mismatch: null }
        : s;

    case "abort":
      // Detection lost. Mid-solve → DNF result. While merely armed → drop any
      // partial start; the FSM re-arms. (No effect once stopped/verifying.)
      if (s.phase === "solving" && s.startT !== null) {
        return {
          ...s,
          phase: "result",
          startT: null,
          stopT: null,
          elapsedMs: 0,
          dnf: true,
          scrambleVerified: false,
        };
      }
      return s.phase === "armed" ? { ...s, startT: null } : s;

    case "again":
      // Fresh cycle without a page reload: back to the calibrate-first screen (NOT
      // loading). The caller regenerates the scramble and clears/re-seeds refs.
      return { ...freshCalibrate };
  }
}
