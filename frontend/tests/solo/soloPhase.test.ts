import { describe, it, expect } from "vitest";
import {
  initialSoloState,
  soloReducer,
  type SoloState,
} from "../../src/solo/soloPhase";

const run = (state: SoloState, ...actions: Parameters<typeof soloReducer>[1][]): SoloState =>
  actions.reduce((s, a) => soloReducer(s, a), state);

describe("soloReducer", () => {
  it("walks the happy path loading → walkthrough → verify → armed → solving → result", () => {
    const s = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "goto_verify" },
      { type: "verify_ok" },
      { type: "solve_start", t: 1000 },
      { type: "solve_stop", t: 8500 },
    );
    expect(s.phase).toBe("result");
    expect(s.scrambleVerified).toBe(true);
    expect(s.startT).toBe(1000);
    expect(s.stopT).toBe(8500);
    expect(s.elapsedMs).toBe(7500); // stopT − startT, from frame timestamps
    expect(s.dnf).toBe(false);
  });

  it("gates the timer: solve_start is ignored until armed", () => {
    // From walkthrough / verify, a stray solve_start does nothing.
    const wt = run(initialSoloState, { type: "scramble_ready" });
    expect(soloReducer(wt, { type: "solve_start", t: 5 }).phase).toBe("walkthrough");
    const vf = soloReducer(wt, { type: "goto_verify" });
    expect(soloReducer(vf, { type: "solve_start", t: 5 }).phase).toBe("verify");
  });

  it("gates the timer: armed but not verified cannot start", () => {
    // Construct the impossible-in-practice armed+unverified state and prove the
    // reducer's second guard (scrambleVerified) also blocks it.
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
    const vf = run(initialSoloState, { type: "scramble_ready" }, { type: "goto_verify" });
    const r = soloReducer(vf, { type: "verify_mismatch", face: "U", count: 4 });
    expect(r.phase).toBe("verify");
    expect(r.scrambleVerified).toBe(false);
    expect(r.mismatch).toEqual({ face: "U", count: 4 });
  });

  it("back_to_walkthrough clears verification and mismatch", () => {
    const vf = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "goto_verify" },
      { type: "verify_mismatch", face: "R", count: 2 },
    );
    const r = soloReducer(vf, { type: "back_to_walkthrough" });
    expect(r.phase).toBe("walkthrough");
    expect(r.mismatch).toBeNull();
    expect(r.scrambleVerified).toBe(false);
  });

  it("abort mid-solve produces a DNF result and clears verification", () => {
    const solving = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "goto_verify" },
      { type: "verify_ok" },
      { type: "solve_start", t: 2000 },
    );
    expect(solving.phase).toBe("solving");
    const r = soloReducer(solving, { type: "abort" });
    expect(r.phase).toBe("result");
    expect(r.dnf).toBe(true);
    expect(r.startT).toBeNull();
    expect(r.scrambleVerified).toBe(false);
  });

  it("abort while merely armed re-arms rather than DNF-ing", () => {
    const armed = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "goto_verify" },
      { type: "verify_ok" },
    );
    const r = soloReducer(armed, { type: "abort" });
    expect(r.phase).toBe("armed");
    expect(r.dnf).toBe(false);
  });

  it("again resets to a fresh loading cycle", () => {
    const done = run(
      initialSoloState,
      { type: "scramble_ready" },
      { type: "goto_verify" },
      { type: "verify_ok" },
      { type: "solve_start", t: 1000 },
      { type: "solve_stop", t: 5000 },
    );
    const r = soloReducer(done, { type: "again" });
    expect(r).toEqual(initialSoloState);
  });
});
