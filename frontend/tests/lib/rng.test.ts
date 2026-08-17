import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/lib/rng";

describe("mulberry32", () => {
  it("same seed produces the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("values stay in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge on the first value", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it("is deterministic across many draws, not just the first", () => {
    const rng = mulberry32(1234);
    const seq1 = Array.from({ length: 500 }, () => rng());
    const rng2 = mulberry32(1234);
    const seq2 = Array.from({ length: 500 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });
});
