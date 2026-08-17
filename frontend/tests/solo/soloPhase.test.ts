import { describe, it, expect } from "vitest";
import { initialSoloState, soloReducer, type SoloState } from "../../src/solo/soloPhase";

const run = (state: SoloState, ...actions: Parameters<typeof soloReducer>[1][]): SoloState =>
  actions.reduce((s, a) => soloReducer(s, a), state);

// Full happy path through the reordered ritual (calibrate-first, honest finish).
const toArmed = (): SoloState =>
  run(
    initialSoloState,
    { type: "scramble_ready" },
    { type: "calibrate_ok" },
    { type: "goto_verify" },
    { type: "verify_ok" },
  );

describe("soloReducer — reordered ritual (calibrate-first, honest finish)", () => {
  it("scramble_ready lands on calibrate (NOT walkthrough): the SOLVED cube is shown first", () => {
    const s = soloReducer(initialSoloState, { type: "scramble_ready" });
    expect(s.phase).toBe("calibrate");
  });

  it("walks calibrate → walkthrough → verify → armed → solving → stopped → solve_verify → result", () => {
    const s = run(
      initialSoloState,
      { type: "scramble_ready" }, // loading → calibrate
      { type: "calibrate_ok" }, // calibrate → walkthrough
      { type: "goto_verify" }, // walkthrough → verify
      { type: "verify_ok" }, // verify → armed
      { type: "solve_start", t: 1000 }, // armed → solving
      { type: "solve_stop", t: 8500 }, // solving → stopped (freeze, NOT result)
      { type: "goto_solve_verify" }, // stopped → solve_verify
      { type: "solve_verify_ok" }, // solve_verify → result
    );
    expect(s.phase).toBe("result");
    expect(s.scrambleVerified).toBe(true);
    expect(s.startT).toBe(1000);
    expect(s.stopT).toBe(8500);
    expect(s.elapsedMs).toBe(7500); // stopT − startT, from frame timestamps
    expect(s.dnf).toBe(false);
  });

  it("calibrate_ok is the ONLY exit from calibrate (timer cannot arm without the honest start)", () => {
    const cal = soloReducer(initialSoloState, { type: "scramble_ready" });
    // A stray goto_verify/verify_ok/solve_start from calibrate does nothing.
    expect(soloReducer(cal, { type: "goto_verify" }).phase).toBe("calibrate");
    expect(soloReducer(cal, { type: "verify_ok" }).phase).toBe("calibrate");
    expect(soloReducer(cal, { type: "solve_start", t: 1 }).phase).toBe("calibrate");
  });

  it("solve_stop freezes into stopped and records elapsed — NOT result", () => {
    const solving = run(toArmed(), { type: "solve_start", t: 2000 });
    const stopped = soloReducer(solving, { type: "solve_stop", t: 5000 });
    expect(stopped.phase).toBe("stopped");
    expect(stopped.elapsedMs).toBe(3000);
    expect(stopped.stopT).toBe(5000);
    expect(stopped.dnf).toBe(false);
  });

  it("solve_verify_ok reaches result; accepted from stopped directly too", () => {
    const stopped = run(
      toArmed(),
      { type: "solve_start", t: 100 },
      { type: "solve_stop", t: 4100 },
    );
    expect(soloReducer(stopped, { type: "solve_verify_ok" }).phase).toBe("result");
  });

  it("solve_verify_mismatch keeps the finish un-confirmed and records the discrepancy", () => {
    const verifying = run(
      toArmed(),
      { type: "solve_start", t: 0 },
      { type: "solve_stop", t: 4000 },
      { type: "goto_solve_verify" },
    );
    const r = soloReducer(verifying, { type: "solve_verify_mismatch", face: "F", count: 3 });
    expect(r.phase).toBe("solve_verify");
    expect(r.mismatch).toEqual({ face: "F", count: 3 });
  });

  it("gates the timer: solve_start is ignored until armed", () => {
    const wt = run(initialSoloState, { type: "scramble_ready" }, { type: "calibrate_ok" });
    expect(soloReducer(wt, { type: "solve_start", t: 5 }).phase).toBe("walkthrough");
    const vf = soloReducer(wt, { type: "goto_verify" });
    expect(soloReducer(vf, { type: "solve_start", t: 5 }).phase).toBe("verify");
  });

  it("gates the timer: armed but not verified cannot start", () => {
    const armedUnverified: SoloState = {
      ...initialSoloState,
      phase: "armed",
      scrambleVerified: false,
    };
    const r = soloReducer(armedUnverified, { type: "solve_start", t: 100 });
    expect(r.phase).toBe("armed");
    expect(r.startT).toBeNull();
  });

  it("verify_mismatch keeps the timer un-armed and records the face", () => {
    const vf = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "calibrate_ok" },
      { type: "goto_verify" },
    );
    const r = soloReducer(vf, { type: "verify_mismatch", face: "U", count: 4 });
    expect(r.phase).toBe("verify");
    expect(r.scrambleVerified).toBe(false);
    expect(r.mismatch).toEqual({ face: "U", count: 4 });
  });

  it("back_to_walkthrough clears verification and mismatch", () => {
    const vf = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "calibrate_ok" },
      { type: "goto_verify" },
      { type: "verify_mismatch", face: "R", count: 2 },
    );
    const r = soloReducer(vf, { type: "back_to_walkthrough" });
    expect(r.phase).toBe("walkthrough");
    expect(r.mismatch).toBeNull();
    expect(r.scrambleVerified).toBe(false);
  });

  it("abort mid-solve produces a DNF result and clears verification", () => {
    const solving = run(toArmed(), { type: "solve_start", t: 2000 });
    expect(solving.phase).toBe("solving");
    const r = soloReducer(solving, { type: "abort" });
    expect(r.phase).toBe("result");
    expect(r.dnf).toBe(true);
    expect(r.startT).toBeNull();
    expect(r.scrambleVerified).toBe(false);
  });

  it("abort while merely armed re-arms rather than DNF-ing", () => {
    const armed = toArmed();
    const r = soloReducer(armed, { type: "abort" });
    expect(r.phase).toBe("armed");
    expect(r.dnf).toBe(false);
  });

  it("initial state is cameraVerified:true (honest by default)", () => {
    expect(initialSoloState.cameraVerified).toBe(true);
  });

  it("verify_skip arms the timer WITHOUT verification, flagging cameraVerified:false", () => {
    const vf = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "calibrate_ok" },
      { type: "goto_verify" },
      { type: "verify_mismatch", face: "U", count: 4 }, // a prior failure, as the UI requires
    );
    const r = soloReducer(vf, { type: "verify_skip" });
    expect(r.phase).toBe("armed");
    expect(r.scrambleVerified).toBe(true); // still gates solve_start the normal way
    expect(r.cameraVerified).toBe(false);
    expect(r.mismatch).toBeNull();
  });

  it("verify_skip is a no-op outside verify", () => {
    const cal = soloReducer(initialSoloState, { type: "scramble_ready" });
    expect(soloReducer(cal, { type: "verify_skip" }).phase).toBe("calibrate");
  });

  it("a skipped verify still gates solve_start normally (armed + scrambleVerified)", () => {
    const skipped = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "calibrate_ok" },
      { type: "goto_verify" },
      { type: "verify_skip" },
    );
    const r = soloReducer(skipped, { type: "solve_start", t: 100 });
    expect(r.phase).toBe("solving");
    expect(r.startT).toBe(100);
  });

  it("solve_verify_skip reaches result WITHOUT confirming the finish, flagging cameraVerified:false", () => {
    const stopped = run(toArmed(), { type: "solve_start", t: 0 }, { type: "solve_stop", t: 4000 });
    const r = soloReducer(stopped, { type: "solve_verify_skip" });
    expect(r.phase).toBe("result");
    expect(r.cameraVerified).toBe(false);
    expect(r.dnf).toBe(false); // distinct from abort — a real (unverified) time, not DNF
  });

  it("solve_verify_skip is a no-op outside stopped/solve_verify", () => {
    const armed = toArmed();
    expect(soloReducer(armed, { type: "solve_verify_skip" }).phase).toBe("armed");
  });

  it("again resets cameraVerified back to true even after a skip", () => {
    const skippedResult = run(
      toArmed(),
      { type: "solve_start", t: 1000 },
      { type: "solve_stop", t: 5000 },
      { type: "solve_verify_skip" },
    );
    expect(skippedResult.cameraVerified).toBe(false);
    const r = soloReducer(skippedResult, { type: "again" });
    expect(r).toEqual({ ...initialSoloState, phase: "calibrate" });
    expect(r.cameraVerified).toBe(true);
  });

  it("again resets to the calibrate-first screen (NOT loading)", () => {
    const done = run(
      toArmed(),
      { type: "solve_start", t: 1000 },
      { type: "solve_stop", t: 5000 },
      { type: "solve_verify_ok" },
    );
    const r = soloReducer(done, { type: "again" });
    expect(r).toEqual({ ...initialSoloState, phase: "calibrate" });
  });
});
