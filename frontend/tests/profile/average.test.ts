// Текущий Ao5 в профиле. Те же примеры, что в backend/tests/test_averages.py —
// правила продублированы в двух местах намеренно, значит и проверяться должны
// одинаково.

import { describe, it, expect } from "vitest";
import type { SolveRead } from "../../src/api/solves";
import { ao5, currentAo5, AVERAGE_SIZE } from "../../src/profile/average";

function solve(time_ms: number, status = "valid"): SolveRead {
  return {
    id: `${time_ms}-${status}-${Math.random()}`,
    scramble: "R U R' U'",
    time_ms,
    status,
    verify_frames_ok: false,
    cube_id: null,
    scramble_id: null,
    created_at: "2026-07-28T10:00:00Z",
  };
}

describe("ao5", () => {
  it("отбрасывает лучшую и худшую", () => {
    expect(ao5([10_000, 20_000, 30_000, 40_000, 50_000])).toBe(30_000);
  });

  it("одна DNF — это и есть отброшенная худшая", () => {
    expect(ao5([null, 10_000, 20_000, 30_000, 40_000])).toBe(30_000);
  });

  it("две DNF делают среднее DNF-ом", () => {
    expect(ao5([null, null, 20_000, 30_000, 40_000])).toBeNull();
  });

  it.each([0, 1, 4, 6])("не считает окно из %i попыток", (n) => {
    expect(ao5(Array.from({ length: n }, () => 12_000))).toBeNull();
  });
});

describe("currentAo5", () => {
  it("берёт пять последних попыток, новые первыми", () => {
    const solves = [24_000, 23_000, 22_000, 21_000, 20_000, 99_000].map((ms) => solve(ms));
    // Окно — первые пять: 24,23,22,21,20 -> отброшены 20 и 24.
    expect(currentAo5(solves)).toBe(22_000);
  });

  it("rejected пропускается целиком, а не считается DNF-ом", () => {
    const solves = [
      solve(24_000),
      solve(99_000, "rejected"),
      solve(23_000),
      solve(22_000),
      solve(21_000),
      solve(20_000),
    ];
    expect(currentAo5(solves)).toBe(22_000);
  });

  it("меньше пяти попыток — среднего нет", () => {
    expect(currentAo5([solve(20_000), solve(21_000)])).toBeNull();
    expect(currentAo5([])).toBeNull();
  });

  it("окно ровно AVERAGE_SIZE", () => {
    expect(AVERAGE_SIZE).toBe(5);
  });
});
