// buildNextCard (solo/nextCardModel.ts): сравнение со средним/рекордом и
// сложенная-с-текущей-сборкой цель. Рекорд/среднее считаются по baseline
// (история ДО этой сборки) — цель, наоборот, с учётом её.

import { describe, it, expect } from "vitest";
import type { SolveRead } from "../../src/api/solves";
import { buildNextCard } from "../../src/solo/nextCardModel";

function solve(time_ms: number, status = "valid"): SolveRead {
  return {
    id: `${time_ms}-${status}-${Math.random()}`,
    scramble: "R U R' U'",
    time_ms,
    status,
    verify_frames_ok: false,
    cube_id: null,
    scramble_id: null,
    created_at: "2026-08-01T10:00:00Z",
  };
}

describe("buildNextCard", () => {
  it("нет истории: сравнивать не с чем, но цель всё равно складывается из текущей сборки", () => {
    const out = buildNextCard([], 30_000);
    expect(out.hasHistory).toBe(false);
    expect(out.averageMs).toBeNull();
    expect(out.recordMs).toBeNull();
    expect(out.vsAverageMs).toBeNull();
    expect(out.recordBeaten).toBe(false);
    expect(out.gapToRecordMs).toBeNull();
    expect(out.beatRecordByMs).toBeNull();
    // Первая сборка — сама себе рекорд, цель уже видна.
    expect(out.goal.bestMs).toBe(30_000);
  });

  it("нет истории и DNF: и сравнения, и цели нет вовсе", () => {
    const out = buildNextCard([], null);
    expect(out.hasHistory).toBe(false);
    expect(out.goal.bestMs).toBeNull();
  });

  it("одна сборка в истории — среднее и рекорд равны ей", () => {
    const out = buildNextCard([solve(40_000)], 35_000);
    expect(out.hasHistory).toBe(true);
    expect(out.averageMs).toBe(40_000);
    expect(out.recordMs).toBe(40_000);
    expect(out.vsAverageMs).toBe(-5_000);
    expect(out.recordBeaten).toBe(true);
    expect(out.beatRecordByMs).toBe(5_000);
    expect(out.gapToRecordMs).toBeNull();
  });

  it("рекорд побит: текущая сборка быстрее прежнего минимума", () => {
    const history = [solve(28_000), solve(31_000), solve(29_500)];
    const out = buildNextCard(history, 27_000);
    expect(out.recordMs).toBe(28_000);
    expect(out.recordBeaten).toBe(true);
    expect(out.beatRecordByMs).toBe(1_000);
    expect(out.gapToRecordMs).toBeNull();
    // Цель теперь считается по 27.0, а не по старому рекорду 28.0.
    expect(out.goal.bestMs).toBe(27_000);
  });

  it("рекорд не побит: остаётся разрыв, а не отрицательное число", () => {
    const history = [solve(28_000), solve(31_000)];
    const out = buildNextCard(history, 30_000);
    expect(out.recordMs).toBe(28_000);
    expect(out.recordBeaten).toBe(false);
    expect(out.beatRecordByMs).toBeNull();
    expect(out.gapToRecordMs).toBe(2_000);
    // Старый рекорд остаётся рекордом для цели — эта попытка его не побила.
    expect(out.goal.bestMs).toBe(28_000);
  });

  it("ровно на рекорде — не побит (строго быстрее), разрыв 0", () => {
    const out = buildNextCard([solve(28_000)], 28_000);
    expect(out.recordBeaten).toBe(false);
    expect(out.gapToRecordMs).toBe(0);
  });

  it("среднее — простое среднее ЗАСЧИТАННЫХ сборок, а не Ao5", () => {
    // 30 000 и 40 000 -> среднее 35 000, а не Ao5 (истории меньше пяти попыток).
    const out = buildNextCard([solve(30_000), solve(40_000)], 33_000);
    expect(out.averageMs).toBe(35_000);
    expect(out.vsAverageMs).toBe(-2_000);
  });

  it("DNF в истории не портит ни среднее, ни рекорд, ни цель", () => {
    const history = [solve(1, "dnf"), solve(29_000), solve(1, "dnf"), solve(31_000)];
    const out = buildNextCard(history, 28_000);
    expect(out.hasHistory).toBe(true);
    expect(out.averageMs).toBe(30_000); // (29000+31000)/2, DNF выброшены
    expect(out.recordMs).toBe(29_000);
    expect(out.recordBeaten).toBe(true);
  });

  it("цель задана: следующий рубеж и разрыв учитывают текущую сборку", () => {
    const out = buildNextCard([solve(41_000)], 36_000);
    expect(out.goal.nextMs).toBe(35_000);
    expect(out.goal.gapMs).toBe(1_000);
  });

  it("цель не задана (все рубежи взяты): следующего рубежа нет", () => {
    const out = buildNextCard([solve(9_000)], 8_000);
    expect(out.goal.nextMs).toBeNull();
    expect(out.goal.holdMs).toBe(10_000);
  });

  it("текущая DNF: цель считается ТОЛЬКО по истории, без синтетической записи", () => {
    const out = buildNextCard([solve(41_000)], null);
    expect(out.goal.bestMs).toBe(41_000);
    expect(out.goal.nextMs).toBe(40_000);
  });
});
