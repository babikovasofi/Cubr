import { describe, it, expect } from "vitest";
import {
  guideStateFor,
  remainingCalibFacesRu,
  verifyMismatchRu,
  cameraDeniedRu,
  modelFailedRu,
  type GuideSnapshot,
} from "../guide.ts";

// A calibrated, light-ok, no-scramble baseline; each test overrides fields.
function base(over: Partial<GuideSnapshot> = {}): GuideSnapshot {
  return {
    cameraOn: true,
    calibrationStep: 6,
    hasRefs: true,
    redOrangeOk: true,
    scrambleSet: false,
    scrambleVerified: false,
    gateMode: "handmix",
    collector: null,
    fsmState: "NO_HANDS",
    solveElapsedMs: 0,
    lastError: null,
    ...over,
  };
}

describe("guideStateFor step transitions", () => {
  it("camera off -> start step recommends btn-start", () => {
    const g = guideStateFor(base({ cameraOn: false, calibrationStep: 0, hasRefs: false }));
    expect(g.step).toBe("start");
    expect(g.activeButtonId).toBe("btn-start");
    expect(g.nowRu).toMatch(/камер/i);
  });

  it("mid-calibration -> calibrate step, progress N/6, next face name", () => {
    const g = guideStateFor(base({ calibrationStep: 1, hasRefs: false }));
    expect(g.step).toBe("calibrate");
    expect(g.activeButtonId).toBe("btn-calibrate");
    expect(g.progress).toBe("Грань 2/6");
    // Second face in U R F D L B order is R = красная.
    expect(g.nowRu).toMatch(/красн/i);
  });

  it("calibration done but red/orange too close -> lightBad, recalibrate", () => {
    const g = guideStateFor(base({ redOrangeOk: false }));
    expect(g.step).toBe("lightBad");
    expect(g.activeButtonId).toBe("btn-calibrate");
    expect(g.nowRu).toMatch(/свет/i);
  });

  it("calibrated, handmix, no scramble -> scrambleReady recommends btn-accuracy", () => {
    const g = guideStateFor(base());
    expect(g.step).toBe("scrambleReady");
    expect(g.activeButtonId).toBe("btn-accuracy");
    expect(g.nowRu).toMatch(/перемеш|руками/i);
  });

  it("solved gate mode changes the copy but still recommends btn-accuracy", () => {
    const g = guideStateFor(base({ gateMode: "solved" }));
    expect(g.step).toBe("scrambleReady");
    expect(g.activeButtonId).toBe("btn-accuracy");
    expect(g.nowRu).toMatch(/собранн/i);
  });

  it("notation scramble set, not verified -> verifyScramble recommends btn-verify", () => {
    const g = guideStateFor(base({ scrambleSet: true }));
    expect(g.step).toBe("verifyScramble");
    expect(g.activeButtonId).toBe("btn-verify");
    expect(g.nowRu).toMatch(/провер/i);
  });

  it("verified + hands idle -> armTimer, no recommended button", () => {
    const g = guideStateFor(base({ scrambleSet: true, scrambleVerified: true }));
    expect(g.step).toBe("armTimer");
    expect(g.activeButtonId).toBeNull();
    expect(g.nowRu).toMatch(/зон/i);
  });

  it("SOLVING -> solving step shows elapsed", () => {
    const g = guideStateFor(
      base({ scrambleSet: true, scrambleVerified: true, fsmState: "SOLVING", solveElapsedMs: 4200 }),
    );
    expect(g.step).toBe("solving");
    expect(g.nowRu).toMatch(/4\.2/);
  });

  it("STOPPED -> stopped step recommends btn-confirm and shows time", () => {
    const g = guideStateFor(base({ fsmState: "STOPPED", solveElapsedMs: 12345 }));
    expect(g.step).toBe("stopped");
    expect(g.activeButtonId).toBe("btn-confirm");
    expect(g.nowRu).toMatch(/12\.345/);
  });
});

describe("collector projection (real progress, never clicks)", () => {
  it("verify collection in progress -> collecting step bound to facesLength", () => {
    const g = guideStateFor(base({ scrambleSet: true, collector: { purpose: "verify", facesLength: 3 } }));
    expect(g.step).toBe("collecting");
    expect(g.activeButtonId).toBe("btn-verify");
    expect(g.nowRu).toMatch(/3\/6/);
    expect(g.progress).toBe("Грань 4/6");
  });

  it("accuracy collection maps to btn-accuracy", () => {
    const g = guideStateFor(base({ collector: { purpose: "accuracy", facesLength: 0 } }));
    expect(g.step).toBe("collecting");
    expect(g.activeButtonId).toBe("btn-accuracy");
    expect(g.progress).toBe("Грань 1/6");
  });
});

describe("error branch", () => {
  it("lastError takes over the panel regardless of other state", () => {
    const g = guideStateFor(base({ fsmState: "SOLVING", lastError: cameraDeniedRu() }));
    expect(g.step).toBe("error");
    expect(g.nowRu).toBe(cameraDeniedRu());
    expect(g.activeButtonId).toBeNull();
  });

  it("camera-denied and model-failed copy are distinct", () => {
    expect(cameraDeniedRu()).not.toBe(modelFailedRu());
    expect(cameraDeniedRu()).toMatch(/камер/i);
    expect(modelFailedRu()).toMatch(/модел/i);
  });

  it("verifyMismatchRu names the Russian face label", () => {
    expect(verifyMismatchRu("L", 3)).toMatch(/оранжев/i);
    expect(verifyMismatchRu("L", 3)).toMatch(/3/);
  });
});

describe("timer gating invariant (skeptic HIGH)", () => {
  it("without scrambleVerified the guide NEVER reaches armTimer/solving", () => {
    // Even with a scramble set and hands active, no verify => stay in verify step.
    const g = guideStateFor(base({ scrambleSet: true, scrambleVerified: false, fsmState: "HANDS_IN_ZONE" }));
    expect(g.step).toBe("verifyScramble");
    expect(["armTimer", "solving"]).not.toContain(g.step);
  });
});

describe("calibration helper", () => {
  it("remainingCalibFacesRu lists faces from the current step", () => {
    expect(remainingCalibFacesRu(0)).toMatch(/белая/i);
    expect(remainingCalibFacesRu(5)).toMatch(/синяя/i);
    expect(remainingCalibFacesRu(6)).toBe("");
  });
});
