import { describe, it, expect } from "vitest";
import {
  makeWalkthrough,
  totalSteps,
  next,
  prev,
  goto,
  algUpTo,
  currentMove,
  lastMove,
  progressFraction,
  isFirst,
  isLast,
} from "../walkthrough.ts";

const MOVES = ["R", "U'", "F2", "D", "L2"]; // 5 moves

describe("walkthrough step machine", () => {
  it("starts at 0 (solved), knows total", () => {
    const w = makeWalkthrough(MOVES);
    expect(w.index).toBe(0);
    expect(totalSteps(w)).toBe(5);
    expect(isFirst(w)).toBe(true);
    expect(isLast(w)).toBe(false);
    expect(algUpTo(w)).toBe("");
    expect(currentMove(w)).toBe("R");
    expect(lastMove(w)).toBe(null);
  });

  it("next advances one move and is clamped at the end", () => {
    const w = makeWalkthrough(MOVES);
    expect(next(w)).toBe(1);
    expect(algUpTo(w)).toBe("R");
    expect(lastMove(w)).toBe("R");
    expect(currentMove(w)).toBe("U'");
    goto(w, 5);
    expect(isLast(w)).toBe(true);
    expect(currentMove(w)).toBe(null);
    expect(next(w)).toBe(5); // clamped, no overrun
  });

  it("prev steps back and is clamped at 0", () => {
    const w = makeWalkthrough(MOVES);
    goto(w, 2);
    expect(prev(w)).toBe(1);
    expect(prev(w)).toBe(0);
    expect(prev(w)).toBe(0); // clamped
    expect(isFirst(w)).toBe(true);
  });

  it("goto clamps and truncates", () => {
    const w = makeWalkthrough(MOVES);
    expect(goto(w, 3)).toBe(3);
    expect(algUpTo(w)).toBe("R U' F2");
    expect(goto(w, -4)).toBe(0);
    expect(goto(w, 99)).toBe(5);
    expect(goto(w, 2.9)).toBe(2);
  });

  it("progressFraction is index/total, 1 for empty", () => {
    const w = makeWalkthrough(MOVES);
    expect(progressFraction(w)).toBe(0);
    goto(w, 5);
    expect(progressFraction(w)).toBe(1);
    expect(progressFraction(makeWalkthrough([]))).toBe(1);
  });
});
