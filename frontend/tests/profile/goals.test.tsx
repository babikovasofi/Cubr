// @vitest-environment jsdom
//
// Цели (V3): рубеж выводится из личного рекорда, серия «под планкой» — из
// последних засчитанных сборок. Ошибиться тут легко в обе стороны: показать
// уже взятый рубеж или обнулить серию из-за DNF.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { SolveRead } from "../../src/api/solves";
import { goalProgress, milestoneLabel, STREAK_TARGET } from "../../src/profile/goals";
import GoalCard from "../../src/profile/GoalCard";

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

describe("goalProgress", () => {
  it("без засчитанных сборок целей нет", () => {
    expect(goalProgress([])).toMatchObject({ nextMs: null, bestMs: null, streakUnder: 0 });
    expect(goalProgress([solve(20_000, "dnf")]).bestMs).toBeNull();
  });

  it("следующий рубеж — первый, который рекорд ещё не пробил", () => {
    expect(goalProgress([solve(34_000)]).nextMs).toBe(30_000);
    expect(goalProgress([solve(75_000)]).nextMs).toBe(60_000);
  });

  it("ровно на рубеже он ещё не взят: sub-N значит строго быстрее N", () => {
    const out = goalProgress([solve(35_000)]);
    expect(out.nextMs).toBe(35_000);
    expect(out.gapMs).toBe(0);
  });

  it("считает разрыв до рубежа по личному рекорду", () => {
    const out = goalProgress([solve(41_500), solve(38_200)]);
    expect(out.nextMs).toBe(35_000);
    expect(out.bestMs).toBe(38_200);
    expect(out.gapMs).toBe(3_200);
  });

  it("серия считается против ПРОБИТОГО рубежа, от свежих назад, и рвётся медленной", () => {
    // Рекорд 28.0 -> следующий рубеж sub-25, закреплять надо sub-30.
    // Свежие первыми: 28, 29, 31(медленная) — серия под sub-30 равна 2.
    const out = goalProgress([solve(28_000), solve(29_000), solve(31_000), solve(28_500)]);
    expect(out.nextMs).toBe(25_000);
    expect(out.holdMs).toBe(30_000);
    expect(out.streakUnder).toBe(2);
    expect(out.stable).toBe(false);
  });

  it("пока не пробит ни один рубеж, закреплять нечего", () => {
    const out = goalProgress([solve(150_000)]);
    expect(out.nextMs).toBe(120_000);
    expect(out.holdMs).toBeNull();
    expect(out.streakUnder).toBe(0);
  });

  it("DNF не рвёт серию и не считается достижением", () => {
    // Рекорд 27.0 -> закрепляем sub-30; пять засчитанных подряд под 30, DNF между ними игнорится.
    const out = goalProgress([
      solve(28_000),
      solve(1, "dnf"),
      solve(29_000),
      solve(27_000),
      solve(28_800),
      solve(29_900),
    ]);
    expect(out.holdMs).toBe(30_000);
    expect(out.streakUnder).toBe(STREAK_TARGET);
    expect(out.stable).toBe(true);
  });

  it("когда взяты все рубежи — следующего нет, остаётся держать последний", () => {
    const out = goalProgress([solve(8_000)]);
    expect(out.nextMs).toBeNull();
    expect(out.holdMs).toBe(10_000);
    expect(out.gapMs).toBeNull();
  });
});

describe("milestoneLabel", () => {
  it.each([
    [30_000, "0:30"],
    [45_000, "0:45"],
    [60_000, "1:00"],
    [90_000, "1:30"],
  ])("%i → %s", (ms, label) => {
    expect(milestoneLabel(ms)).toBe(label);
  });
});

describe("GoalCard", () => {
  it("зовёт собрать первую сборку, когда истории нет", () => {
    render(<GoalCard solves={[]} />);
    expect(screen.getByText(/после первой засчитанной сборки/)).toBeTruthy();
  });

  it("показывает следующий рубеж и разрыв до него", () => {
    render(<GoalCard solves={[solve(33_000), solve(31_000)]} />);

    expect(screen.getByText(/Цель: собрать быстрее 0:30/)).toBeTruthy();
    expect(screen.getByText(/До рубежа/)).toBeTruthy();
    // 0:35 уже пробит рекордом 31.0 — его и закрепляем.
    expect(screen.getByText(/подряд ниже 0:35/)).toBeTruthy();
    expect(screen.getAllByTestId("goal-cell")).toHaveLength(STREAK_TARGET);
  });

  it("отмечает, что пробитый рубеж держится стабильно", () => {
    const fast = [29_100, 29_200, 29_300, 29_400, 29_500].map((ms) => solve(ms));
    render(<GoalCard solves={fast} />);
    expect(screen.getByText(/рубеж держится/)).toBeTruthy();
  });

  it("до первого пробитого рубежа объясняет, что счётчик появится позже", () => {
    render(<GoalCard solves={[solve(150_000)]} />);
    expect(screen.getByText(/появится счётчик стабильности/)).toBeTruthy();
    expect(screen.queryAllByTestId("goal-cell")).toHaveLength(0);
  });
});
