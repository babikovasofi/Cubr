// Pure hands-gate debounce that fixes the "готово without hands" onboarding bug:
// a single spurious detected frame must NOT confirm; only a sustained run does.

import { describe, it, expect } from "vitest";
import { advanceHandsGate, HANDS_CONFIRM_FRAMES } from "../../src/onboarding/useCameraCheck";

describe("advanceHandsGate", () => {
  it("does not confirm below the threshold of consecutive detected frames", () => {
    let run = 0;
    let seen = false;
    for (let i = 0; i < HANDS_CONFIRM_FRAMES - 1; i++) {
      ({ run, seen } = advanceHandsGate(run, true));
      expect(seen).toBe(false);
    }
    expect(run).toBe(HANDS_CONFIRM_FRAMES - 1);
  });

  it("confirms exactly at the threshold", () => {
    let run = 0;
    let seen = false;
    for (let i = 0; i < HANDS_CONFIRM_FRAMES; i++) {
      ({ run, seen } = advanceHandsGate(run, true));
    }
    expect(seen).toBe(true);
    expect(run).toBe(HANDS_CONFIRM_FRAMES);
  });

  it("resets the run on a not-detected frame — a single spurious frame never latches", () => {
    // 5 detected, then a miss, then 1 detected: run must be back to 1, not near threshold.
    let run = 0;
    for (let i = 0; i < 5; i++) ({ run } = advanceHandsGate(run, true));
    ({ run } = advanceHandsGate(run, false));
    expect(run).toBe(0);
    const step = advanceHandsGate(run, true);
    expect(step.run).toBe(1);
    expect(step.seen).toBe(false);
  });

  it("a lone detected frame among misses never confirms", () => {
    let run = 0;
    let seen = false;
    const pattern = [true, false, true, false, true, false, true];
    for (const detected of pattern) ({ run, seen } = advanceHandsGate(run, detected));
    expect(seen).toBe(false);
  });

  it("honours a custom threshold", () => {
    let run = 0;
    let seen = false;
    ({ run, seen } = advanceHandsGate(run, true, 2));
    expect(seen).toBe(false);
    ({ run, seen } = advanceHandsGate(run, true, 2));
    expect(seen).toBe(true);
  });
});
