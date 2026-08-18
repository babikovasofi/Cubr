// Личная аналитика сборок (V3 «коуч»), считается на клиенте из УЖЕ загруженной
// истории (`listSolves(50)` в профиле, тот же приём, что у `goals.ts`/`average.ts`)
// — ни эндпоинта, ни таблицы, ни второго запроса.
//
// Честная рамка (см. roadmap.md V3 + план фичи): настоящий разбор сборки по фазам
// (крест→F2L→OLL→PLL) требует зрения по видео, которого нет и не будет, пока не
// снят риск R1. Здесь НЕТ фаз и НЕТ утверждений о технике — только статистика по
// уже известным величинам: времени, статусу и порядку сборок.
//
// Числовые метрики скорости (медиана/разброс/рекорд-vs-типичное/тренд) считаются
// СТРОГО по `status==="valid"` — `dnf` не подставляется как «медленное время»: это
// не-попытка для арифметики времени, а не плохой результат (та же трактовка, что
// в `average.ts`/`goals.ts`). `rejected` — тоже не-попытка (ритуал не соблюдён) и
// не входит вообще никуда, как в `daily/streak`. Доля DNF — отдельная метрика по
// попыткам `valid|dnf`.

import type { SolveRead } from "../api/solves";

/**
 * Минимальный размер ОДНОГО окна (валидных сборок для скоростных метрик, попыток
 * valid+dnf для доли DNF), прежде чем модуль вообще произносит числовой вывод.
 * Не новое число: та же величина, что `AVERAGE_SIZE` (Ao5) и `STREAK_TARGET` в
 * `goals.ts` — проект уже доверяет этому уровню на пяти попытках.
 *
 * Тренд (скоростной и DNF) сравнивает ДВА окна по MIN_SAMPLE — то есть требует
 * 2×MIN_SAMPLE. Пример из задачи «на пяти сборках "стал быстрее на 12%" — шум»
 * закрыт структурно: на пяти валидных сборках тренда не будет вообще, это ровно
 * одно окно, сравнивать не с чем.
 */
export const MIN_SAMPLE = 5;

/**
 * Рекорд минимум на 30% быстрее типичного (медианы) окна — «возможно, повезло».
 * Эвристика, не статистическая значимость; UI говорит «возможно», не «наверняка».
 */
export const SPIKE_RATIO = 1.3;

export interface CoachSummary {
  /** Валидных сборок в окне. */
  validCount: number;
  /** Попыток (valid+dnf) в окне; `rejected` исключён. */
  attemptCount: number;

  /** Типичное время окна. `null`, пока `validCount < MIN_SAMPLE`. */
  medianMs: number | null;
  /** Нижняя граница межквартильного размаха (25-й перцентиль). */
  p25Ms: number | null;
  /** Верхняя граница межквартильного размаха (75-й перцентиль). */
  p75Ms: number | null;

  /** Лучшая валидная сборка окна. */
  bestMs: number | null;
  /** Худшая валидная сборка окна. */
  worstMs: number | null;
  /** medianMs / bestMs, >= 1. Насколько типичное время дальше рекорда. */
  gapRatio: number | null;
  /** `gapRatio >= SPIKE_RATIO` — рекорд заметно выделяется на фоне типичного темпа. */
  likelyLucky: boolean;

  /** Медиана последних MIN_SAMPLE валидных сборок. `null` до 2×MIN_SAMPLE валидных. */
  trendRecentMedianMs: number | null;
  /** Медиана предыдущих MIN_SAMPLE валидных сборок (перед recent). */
  trendPriorMedianMs: number | null;
  /** Изменение recent к prior в процентах; отрицательное значит «стало быстрее». */
  trendDeltaPct: number | null;

  /** Доля DNF по ВСЕМ попыткам окна. `null`, пока `attemptCount < MIN_SAMPLE`. */
  dnfRate: number | null;
  /** Доля DNF среди последних MIN_SAMPLE попыток. `null` до 2×MIN_SAMPLE попыток. */
  dnfTrendRecentRate: number | null;
  /** Доля DNF среди предыдущих MIN_SAMPLE попыток (перед recent). */
  dnfTrendPriorRate: number | null;
  /** Изменение recent к prior в процентных пунктах. */
  dnfTrendDeltaPts: number | null;
}

/** Линейная интерполяция перцентиля по ВОЗРАСТАЮЩЕ отсортированному массиву. */
function percentile(sortedAsc: number[], p: number): number {
  const len = sortedAsc.length;
  if (len === 1) return sortedAsc[0];
  const idx = (p / 100) * (len - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function median(sortedAsc: number[]): number {
  return percentile(sortedAsc, 50);
}

function asc(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function buildCoachSummary(solves: SolveRead[]): CoachSummary {
  // Новые первыми — тот же порядок, что отдаёт `GET /solves` (см. average.ts/goals.ts).
  const attempts = solves.filter((s) => s.status === "valid" || s.status === "dnf");
  const validTimesRecentFirst = solves.filter((s) => s.status === "valid").map((s) => s.time_ms);

  const validCount = validTimesRecentFirst.length;
  const attemptCount = attempts.length;

  const haveSpread = validCount >= MIN_SAMPLE;
  const sortedValid = haveSpread ? asc(validTimesRecentFirst) : [];

  const medianMs = haveSpread ? median(sortedValid) : null;
  const p25Ms = haveSpread ? percentile(sortedValid, 25) : null;
  const p75Ms = haveSpread ? percentile(sortedValid, 75) : null;
  const bestMs = haveSpread ? sortedValid[0] : null;
  const worstMs = haveSpread ? sortedValid[sortedValid.length - 1] : null;
  const gapRatio = medianMs !== null && bestMs !== null && bestMs > 0 ? medianMs / bestMs : null;
  const likelyLucky = gapRatio !== null && gapRatio >= SPIKE_RATIO;

  const haveTrend = validCount >= MIN_SAMPLE * 2;
  let trendRecentMedianMs: number | null = null;
  let trendPriorMedianMs: number | null = null;
  let trendDeltaPct: number | null = null;
  if (haveTrend) {
    const recent = asc(validTimesRecentFirst.slice(0, MIN_SAMPLE));
    const prior = asc(validTimesRecentFirst.slice(MIN_SAMPLE, MIN_SAMPLE * 2));
    trendRecentMedianMs = median(recent);
    trendPriorMedianMs = median(prior);
    trendDeltaPct =
      trendPriorMedianMs > 0
        ? ((trendRecentMedianMs - trendPriorMedianMs) / trendPriorMedianMs) * 100
        : null;
  }

  const haveDnf = attemptCount >= MIN_SAMPLE;
  const dnfRate = haveDnf ? attempts.filter((a) => a.status === "dnf").length / attemptCount : null;

  const haveDnfTrend = attemptCount >= MIN_SAMPLE * 2;
  let dnfTrendRecentRate: number | null = null;
  let dnfTrendPriorRate: number | null = null;
  let dnfTrendDeltaPts: number | null = null;
  if (haveDnfTrend) {
    const recentAttempts = attempts.slice(0, MIN_SAMPLE);
    const priorAttempts = attempts.slice(MIN_SAMPLE, MIN_SAMPLE * 2);
    dnfTrendRecentRate = recentAttempts.filter((a) => a.status === "dnf").length / MIN_SAMPLE;
    dnfTrendPriorRate = priorAttempts.filter((a) => a.status === "dnf").length / MIN_SAMPLE;
    dnfTrendDeltaPts = (dnfTrendRecentRate - dnfTrendPriorRate) * 100;
  }

  return {
    validCount,
    attemptCount,
    medianMs,
    p25Ms,
    p75Ms,
    bestMs,
    worstMs,
    gapRatio,
    likelyLucky,
    trendRecentMedianMs,
    trendPriorMedianMs,
    trendDeltaPct,
    dnfRate,
    dnfTrendRecentRate,
    dnfTrendPriorRate,
    dnfTrendDeltaPts,
  };
}
