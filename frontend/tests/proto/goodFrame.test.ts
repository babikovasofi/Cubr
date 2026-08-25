import { describe, it, expect } from "vitest";
import {
  classifyFrame,
  defaultThresholds,
  GoodFrameTracker,
  type FrameSignal,
} from "../../src/proto/goodFrame";

const GOOD: FrameSignal = { luma: 120, gap: 20, edge: 20, skinMax: 0 };
const cfg = defaultThresholds();

describe("classifyFrame", () => {
  it("accepts a well-lit frame with a clear lattice and no skin", () => {
    expect(classifyFrame(GOOD, cfg)).toEqual({ ok: true, reason: null });
  });

  it("rejects a frame darker than lumaMin", () => {
    const v = classifyFrame({ ...GOOD, luma: cfg.lumaMin - 1 }, cfg);
    expect(v).toEqual({ ok: false, reason: "dark" });
  });

  it("rejects a frame brighter than lumaMax", () => {
    const v = classifyFrame({ ...GOOD, luma: cfg.lumaMax + 1 }, cfg);
    expect(v).toEqual({ ok: false, reason: "bright" });
  });

  it("rejects a finger over the face before checking the lattice", () => {
    // Dark AND fingered -> dark wins (luma is checked first, matches the
    // product's own gate order: readable() luma-gates before anything else).
    const v = classifyFrame({ ...GOOD, skinMax: cfg.skinMax + 0.1 }, cfg);
    expect(v).toEqual({ ok: false, reason: "finger" });
  });

  it("rejects when neither gap nor edge shows a lattice", () => {
    const v = classifyFrame({ ...GOOD, gap: 0, edge: 0 }, cfg);
    expect(v).toEqual({ ok: false, reason: "no-lattice" });
  });

  it("accepts when only the gap signal clears the bar (stickered cube)", () => {
    const v = classifyFrame({ ...GOOD, edge: 0 }, cfg);
    expect(v.ok).toBe(true);
  });

  it("accepts when only the edge signal clears the bar (stickerless cube)", () => {
    const v = classifyFrame({ ...GOOD, gap: 0 }, cfg);
    expect(v.ok).toBe(true);
  });
});

describe("GoodFrameTracker debounce/hysteresis", () => {
  it("starts at zero confidence / seeking", () => {
    const tracker = new GoodFrameTracker(cfg);
    const q = tracker.push({ ok: false, reason: "no-lattice" }, 0);
    expect(q).toEqual({ confidence: 0, status: "seeking", reason: "no-lattice" });
  });

  it("ramps confidence linearly over holdMs of consecutive ok frames", () => {
    const tracker = new GoodFrameTracker(cfg);
    const t0 = 1000;
    tracker.push({ ok: true, reason: null }, t0);
    const mid = tracker.push({ ok: true, reason: null }, t0 + cfg.holdMs / 2);
    expect(mid.confidence).toBeCloseTo(0.5, 1);
    expect(mid.status).toBe("aligning");
  });

  it("reaches status=good once held for holdMs", () => {
    const tracker = new GoodFrameTracker(cfg);
    const t0 = 1000;
    tracker.push({ ok: true, reason: null }, t0);
    const end = tracker.push({ ok: true, reason: null }, t0 + cfg.holdMs);
    expect(end.confidence).toBe(1);
    expect(end.status).toBe("good");
  });

  it("does not reset instantly on a single bad frame — decays smoothly instead", () => {
    const tracker = new GoodFrameTracker(cfg);
    const t0 = 1000;
    tracker.push({ ok: true, reason: null }, t0);
    tracker.push({ ok: true, reason: null }, t0 + cfg.holdMs); // confidence = 1
    // One bad frame a moment later should NOT snap confidence to 0.
    const afterBad = tracker.push({ ok: false, reason: "no-lattice" }, t0 + cfg.holdMs + 10);
    expect(afterBad.confidence).toBeGreaterThan(0.9);
    expect(afterBad.confidence).toBeLessThan(1);
  });

  it("fully decays to 0 after decayMs of consecutive bad frames", () => {
    const tracker = new GoodFrameTracker(cfg);
    const t0 = 1000;
    tracker.push({ ok: true, reason: null }, t0);
    tracker.push({ ok: true, reason: null }, t0 + cfg.holdMs); // confidence = 1
    const decayed = tracker.push(
      { ok: false, reason: "dark" },
      t0 + cfg.holdMs + cfg.decayMs,
    );
    expect(decayed.confidence).toBe(0);
    expect(decayed.status).toBe("seeking");
  });

  it("a brief interruption followed by more good frames still reaches good eventually", () => {
    const tracker = new GoodFrameTracker(cfg);
    let t = 1000;
    tracker.push({ ok: true, reason: null }, t);
    t += cfg.holdMs / 3;
    tracker.push({ ok: false, reason: "no-lattice" }, t); // brief blip, small decay
    t += 5;
    tracker.push({ ok: true, reason: null }, t); // resumes accumulating from t
    t += cfg.holdMs; // plenty of time held from this new start
    const q = tracker.push({ ok: true, reason: null }, t);
    expect(q.status).toBe("good");
  });

  it("reset() returns the tracker to seeking/0", () => {
    const tracker = new GoodFrameTracker(cfg);
    const t0 = 1000;
    tracker.push({ ok: true, reason: null }, t0);
    tracker.push({ ok: true, reason: null }, t0 + cfg.holdMs);
    tracker.reset();
    const q = tracker.push({ ok: false, reason: null }, t0 + cfg.holdMs + 1);
    expect(q).toEqual({ confidence: 0, status: "seeking", reason: null });
  });
});
