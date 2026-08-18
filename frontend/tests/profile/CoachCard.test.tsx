// @vitest-environment jsdom
//
// Коуч-карточка (V3): рендер честно отражает недостаток данных и не показывает
// чисел, которых `coach.ts` ещё не посчитал.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { SolveRead } from "../../src/api/solves";
import { MIN_SAMPLE } from "../../src/profile/coach";
import CoachCard from "../../src/profile/CoachCard";

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

afterEach(cleanup);

describe("CoachCard", () => {
  it("пустая история — просит ещё сборок, без чисел выводов", () => {
    render(<CoachCard solves={[]} />);
    expect(screen.getByText(/Нужно ещё 5 сборок/)).toBeTruthy();
    expect(screen.queryByText(/Обычно собираешь/)).toBeNull();
    expect(screen.queryByText(/Доля незавершённых сборок:/)).toBeNull();
  });

  it("ровно MIN_SAMPLE валидных — показывает разброс/рекорд, тренд ещё «нужно ещё»", () => {
    const solves = [30_000, 31_000, 29_000, 32_000, 28_000].map((ms) => solve(ms));
    expect(solves.length).toBe(MIN_SAMPLE);
    render(<CoachCard solves={solves} />);

    expect(screen.getByText(/Обычно собираешь между/)).toBeTruthy();
    expect(screen.getByText(/Лучшая .* · типичная .* · худшая/)).toBeTruthy();
    expect(screen.getByText(/Тренд появится после ещё 5 сборок/)).toBeTruthy();
  });

  it("2×MIN_SAMPLE сборок с ясным ускорением — показывает «быстрее на N%»", () => {
    const solves = [
      18_000,
      18_200,
      18_100,
      18_300,
      17_900, // recent, быстрее
      24_000,
      24_200,
      24_100,
      24_300,
      23_900, // prior, медленнее
    ].map((ms) => solve(ms));
    render(<CoachCard solves={solves} />);
    expect(screen.getByText(/быстрее на \d/)).toBeTruthy();
  });

  it("все DNF — показывает долю DNF, но не разброс/рекорд", () => {
    const solves = Array.from({ length: 6 }, () => solve(1, "dnf"));
    render(<CoachCard solves={solves} />);
    expect(screen.getByText(/Доля незавершённых сборок: 100%/)).toBeTruthy();
    expect(screen.queryByText(/Обычно собираешь/)).toBeNull();
  });

  it("рекорд намного быстрее типичного — отмечает «возможно, повезло»", () => {
    const solves = [50_000, 51_000, 49_500, 50_500, 10_000].map((ms) => solve(ms));
    render(<CoachCard solves={solves} />);
    expect(screen.getByText(/возможно, повезло/)).toBeTruthy();
  });

  it("рекорд близко к типичному — «стабильный уровень», без «повезло»", () => {
    const solves = [20_000, 20_100, 19_900, 20_050, 19_950].map((ms) => solve(ms));
    render(<CoachCard solves={solves} />);
    expect(screen.getByText(/стабильный уровень/)).toBeTruthy();
    expect(screen.queryByText(/возможно, повезло/)).toBeNull();
  });
});
