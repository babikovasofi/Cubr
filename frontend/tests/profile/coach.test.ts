// Коуч-аналитика (V3): все числовые выводы гейтятся `MIN_SAMPLE`, DNF и rejected —
// не-попытки для арифметики времени (та же трактовка, что в average.ts/goals.ts).

import { describe, it, expect } from "vitest";
import type { SolveRead } from "../../src/api/solves";
import { buildCoachSummary, MIN_SAMPLE, SPIKE_RATIO } from "../../src/profile/coach";

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

describe("buildCoachSummary", () => {
  it("пустая история — всё null/ноль", () => {
    const out = buildCoachSummary([]);
    expect(out.validCount).toBe(0);
    expect(out.attemptCount).toBe(0);
    expect(out.medianMs).toBeNull();
    expect(out.p25Ms).toBeNull();
    expect(out.p75Ms).toBeNull();
    expect(out.bestMs).toBeNull();
    expect(out.worstMs).toBeNull();
    expect(out.gapRatio).toBeNull();
    expect(out.likelyLucky).toBe(false);
    expect(out.trendDeltaPct).toBeNull();
    expect(out.dnfRate).toBeNull();
    expect(out.dnfTrendDeltaPts).toBeNull();
  });

  it("одна валидная сборка — MIN_SAMPLE не достигнут, всё ещё null", () => {
    const out = buildCoachSummary([solve(20_000)]);
    expect(out.validCount).toBe(1);
    expect(out.medianMs).toBeNull();
    expect(out.bestMs).toBeNull();
    expect(out.dnfRate).toBeNull(); // и попыток тоже меньше MIN_SAMPLE
  });

  it("все DNF — доля DNF считается, скоростные метрики нет", () => {
    const solves = Array.from({ length: 6 }, () => solve(1, "dnf"));
    const out = buildCoachSummary(solves);
    expect(out.validCount).toBe(0);
    expect(out.medianMs).toBeNull();
    expect(out.bestMs).toBeNull();
    expect(out.attemptCount).toBe(6);
    expect(out.dnfRate).toBe(1);
  });

  it("ровно на границе порога (MIN_SAMPLE валидных) — метрики окна считаются", () => {
    const solves = [30_000, 31_000, 29_000, 32_000, 28_000].map((ms) => solve(ms));
    expect(solves.length).toBe(MIN_SAMPLE);
    const out = buildCoachSummary(solves);
    expect(out.medianMs).not.toBeNull();
    expect(out.p25Ms).not.toBeNull();
    expect(out.p75Ms).not.toBeNull();
    expect(out.bestMs).toBe(28_000);
    expect(out.worstMs).toBe(32_000);
    expect(out.gapRatio).not.toBeNull();
    // тренду нужно 2×MIN_SAMPLE — на пяти сборках его нет.
    expect(out.trendRecentMedianMs).toBeNull();
    expect(out.trendDeltaPct).toBeNull();
  });

  it("на единицу ниже границы (MIN_SAMPLE-1 валидных) — метрики окна ещё null", () => {
    const solves = [30_000, 31_000, 29_000, 32_000].map((ms) => solve(ms));
    expect(solves.length).toBe(MIN_SAMPLE - 1);
    const out = buildCoachSummary(solves);
    expect(out.medianMs).toBeNull();
    expect(out.bestMs).toBeNull();
    expect(out.worstMs).toBeNull();
  });

  it("пороги валидных сборок и попыток независимы: DNF добивает попытки до MIN_SAMPLE раньше валидных", () => {
    // 4 валидных (< MIN_SAMPLE) + 1 dnf = 5 попыток (== MIN_SAMPLE).
    const solves = [solve(30_000), solve(31_000), solve(29_000), solve(32_000), solve(1, "dnf")];
    const out = buildCoachSummary(solves);
    expect(out.validCount).toBe(4);
    expect(out.medianMs).toBeNull(); // валидных всё ещё меньше MIN_SAMPLE
    expect(out.attemptCount).toBe(5);
    expect(out.dnfRate).toBe(0.2); // уже считается
  });

  it("граница скоростного тренда: 2×MIN_SAMPLE валидных — считается, на единицу меньше — нет", () => {
    const ten = Array.from({ length: 10 }, (_, i) => solve(20_000 + i * 100));
    const nine = ten.slice(1);

    const outTen = buildCoachSummary(ten);
    expect(outTen.trendRecentMedianMs).not.toBeNull();
    expect(outTen.trendPriorMedianMs).not.toBeNull();
    expect(outTen.trendDeltaPct).not.toBeNull();

    const outNine = buildCoachSummary(nine);
    expect(outNine.validCount).toBe(9);
    expect(outNine.trendRecentMedianMs).toBeNull();
    expect(outNine.trendDeltaPct).toBeNull();
  });

  it("граница DNF-тренда: 2×MIN_SAMPLE попыток — считается, на единицу меньше — нет", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      solve(20_000 + i, i % 3 === 0 ? "dnf" : "valid"),
    );
    const nine = ten.slice(1);

    const outTen = buildCoachSummary(ten);
    expect(outTen.attemptCount).toBe(10);
    expect(outTen.dnfTrendRecentRate).not.toBeNull();
    expect(outTen.dnfTrendDeltaPts).not.toBeNull();

    const outNine = buildCoachSummary(nine);
    expect(outNine.attemptCount).toBe(9);
    expect(outNine.dnfTrendRecentRate).toBeNull();
    expect(outNine.dnfTrendDeltaPts).toBeNull();
  });

  it("выброс не ломает вывод: направление тренда сохраняется, worst честно отражает выброс", () => {
    // Свежие первыми: первые 5 (recent) заметно быстрее последних 5 (prior).
    const clean = [
      solve(18_000),
      solve(18_200),
      solve(18_100),
      solve(18_300),
      solve(17_900),
      solve(24_000),
      solve(24_200),
      solve(24_100),
      solve(24_300),
      solve(23_900),
    ];
    const cleanOut = buildCoachSummary(clean);
    expect(cleanOut.trendDeltaPct).not.toBeNull();
    expect(cleanOut.trendDeltaPct!).toBeLessThan(0); // стало быстрее

    // Тот же набор, но в "prior"-половину воткнут гигантский выброс вместо одной сборки.
    const withOutlier = [
      solve(18_000),
      solve(18_200),
      solve(18_100),
      solve(18_300),
      solve(17_900),
      solve(24_000),
      solve(24_200),
      solve(999_000), // выброс
      solve(24_300),
      solve(23_900),
    ];
    const outlierOut = buildCoachSummary(withOutlier);
    expect(outlierOut.trendDeltaPct).not.toBeNull();
    expect(outlierOut.trendDeltaPct!).toBeLessThan(0); // направление не переворачивается
    // При этом выброс честно виден как худшая сборка окна.
    expect(outlierOut.worstMs).toBe(999_000);
  });

  it("DNF не считается «медленной сборкой»: не входит в median/best/worst/p25/p75", () => {
    const solves = [
      solve(20_000),
      solve(1, "dnf"),
      solve(21_000),
      solve(19_000),
      solve(22_000),
      solve(20_500),
    ];
    const out = buildCoachSummary(solves);
    expect(out.validCount).toBe(5); // dnf не считается валидной
    expect(out.bestMs).toBe(19_000);
    expect(out.worstMs).toBe(22_000); // не 1мс (dnf-заглушка)
    expect(out.attemptCount).toBe(6); // но попытка была
  });

  it("rejected — тоже не-попытка: не входит ни в validCount, ни в attemptCount, ни в dnfRate", () => {
    const solves = [
      solve(20_000),
      solve(21_000),
      solve(19_000),
      solve(22_000),
      solve(20_500),
      solve(99_000, "rejected"),
    ];
    const out = buildCoachSummary(solves);
    expect(out.validCount).toBe(5);
    expect(out.attemptCount).toBe(5); // rejected не попадает в попытки
    expect(out.dnfRate).toBe(0);
  });

  it("детерминированность: одинаковый вход даёт одинаковый результат и не мутирует его", () => {
    const solves = Array.from({ length: 12 }, (_, i) =>
      solve(20_000 + i * 137, i % 4 === 0 ? "dnf" : "valid"),
    );
    const snapshot = JSON.parse(JSON.stringify(solves));

    const first = buildCoachSummary(solves);
    const second = buildCoachSummary(solves);

    expect(first).toEqual(second);
    expect(solves).toEqual(snapshot); // вход не тронут
  });

  it("likelyLucky: рекорд намного быстрее типичного — true, близко к типичному — false", () => {
    const lucky = [50_000, 51_000, 49_500, 50_500, 10_000].map((ms) => solve(ms));
    const luckyOut = buildCoachSummary(lucky);
    expect(luckyOut.gapRatio).toBeGreaterThanOrEqual(SPIKE_RATIO);
    expect(luckyOut.likelyLucky).toBe(true);

    const steady = [20_000, 20_100, 19_900, 20_050, 19_950].map((ms) => solve(ms));
    const steadyOut = buildCoachSummary(steady);
    expect(steadyOut.gapRatio).toBeLessThan(SPIKE_RATIO);
    expect(steadyOut.likelyLucky).toBe(false);
  });
});
