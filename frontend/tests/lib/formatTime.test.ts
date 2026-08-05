import { describe, it, expect } from "vitest";
import { formatSolveMs } from "../../src/lib/formatTime";

describe("formatSolveMs — seconds", () => {
  it("always shows total seconds with 2 decimals, never minutes", () => {
    expect(formatSolveMs(12340, "seconds")).toBe("12.34");
    expect(formatSolveMs(83450, "seconds")).toBe("83.45");
    expect(formatSolveMs(500, "seconds")).toBe("0.50");
    expect(formatSolveMs(60000, "seconds")).toBe("60.00");
    expect(formatSolveMs(0, "seconds")).toBe("0.00");
    expect(formatSolveMs(600000, "seconds")).toBe("600.00");
  });
});

describe("formatSolveMs — clock", () => {
  it("shows plain seconds under a minute", () => {
    expect(formatSolveMs(12340, "clock")).toBe("12.34");
    expect(formatSolveMs(59990, "clock")).toBe("59.99");
    expect(formatSolveMs(500, "clock")).toBe("0.50");
  });

  it("shows M:SS.cc at or over a minute, zero-padded", () => {
    expect(formatSolveMs(60000, "clock")).toBe("1:00.00");
    expect(formatSolveMs(83450, "clock")).toBe("1:23.45");
    expect(formatSolveMs(63050, "clock")).toBe("1:03.05");
    expect(formatSolveMs(600000, "clock")).toBe("10:00.00");
  });

  it("rounds at the minute boundary consistently", () => {
    // 59.995s rounds up to 60.00 -> 1:00.00 in clock, 60.00 in seconds.
    expect(formatSolveMs(59995, "clock")).toBe("1:00.00");
    expect(formatSolveMs(59995, "seconds")).toBe("60.00");
  });

  it("clamps negatives to zero", () => {
    expect(formatSolveMs(-100, "clock")).toBe("0.00");
    expect(formatSolveMs(-100, "seconds")).toBe("0.00");
  });
});
