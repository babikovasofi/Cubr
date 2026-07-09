import { describe, it, expect } from "vitest";
import { fmtSec } from "../../src/vision/time";

describe("fmtSec", () => {
  it("formats whole seconds with 3 decimals", () => {
    expect(fmtSec(0)).toBe("0.000");
    expect(fmtSec(1000)).toBe("1.000");
    expect(fmtSec(12345)).toBe("12.345");
  });

  it("rounds to milliseconds", () => {
    expect(fmtSec(1234.5)).toBe("1.235");
    expect(fmtSec(999.4)).toBe("0.999");
  });

  it("clamps negatives and non-finite to zero", () => {
    expect(fmtSec(-50)).toBe("0.000");
    expect(fmtSec(Number.NaN)).toBe("0.000");
    expect(fmtSec(Number.POSITIVE_INFINITY)).toBe("0.000");
  });
});
