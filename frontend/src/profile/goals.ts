// Цели (V3 «Цели и стрики»), считаются на клиенте из УЖЕ загруженной истории
// (`listSolves(50)` в профиле) — ни эндпоинта, ни таблицы, ни второго запроса,
// как у `SolveProgressChart`.
//
// Цель не выбирается вручную: следующий рубеж выводится из личного рекорда. Так
// не нужно ни поле в БД, ни экран настройки цели, и цель не «протухает» после
// прогресса. Планка sub-N — то, как о времени говорят сами куберы.

import type { SolveRead } from "../api/solves";

/** Рубежи в мс, от медленного к быстрому. */
export const MILESTONES_MS = [
  120_000, 90_000, 60_000, 45_000, 40_000, 35_000, 30_000, 25_000, 20_000, 15_000, 12_000, 10_000,
] as const;

/** Сколько подряд нужно уложиться в планку, чтобы считать её взятой стабильно. */
export const STREAK_TARGET = 5;

export interface GoalProgress {
  /** Следующий не взятый рубеж, мс. null — все рубежи пройдены. */
  nextMs: number | null;
  /** Личный рекорд среди засчитанных сборок, мс. null — засчитанных нет. */
  bestMs: number | null;
  /** Сколько осталось до рубежа по рекорду, мс. null — рекорда/рубежа нет. */
  gapMs: number | null;
  /**
   * Последний УЖЕ пробитый рубеж — тот, который осталось закрепить. null, если
   * не пробит ещё ни один. Серия считается против него, а не против `nextMs`:
   * «5 подряд быстрее рубежа, которого ты пока даже не касался» — бессмысленная
   * метрика, всегда 0.
   */
  holdMs: number | null;
  /** Сколько последних подряд сборок ниже `holdMs` (0..STREAK_TARGET). */
  streakUnder: number;
  /** `holdMs` держится стабильно: STREAK_TARGET подряд ниже него. */
  stable: boolean;
}

function validTimes(solves: SolveRead[]): number[] {
  return solves.filter((s) => s.status === "valid").map((s) => s.time_ms);
}

/** Сколько последних подряд сборок быстрее `ms` (считая от самой свежей). */
function recentStreakUnder(times: number[], ms: number): number {
  let streak = 0;
  for (const t of times) {
    if (t >= ms) break;
    streak += 1;
    if (streak === STREAK_TARGET) break;
  }
  return streak;
}

/**
 * Прогресс к следующему рубежу.
 *
 * `solves` — как их отдаёт `GET /solves`: новые первыми. DNF/rejected в расчёт
 * не идут вообще (ни как «ниже планки», ни как обрыв серии) — иначе один DNF
 * обнулял бы честный прогресс, а sub-N про скорость, а не про дисциплину;
 * серия сборок «под планкой» здесь — это про времена, а не про ежедневность
 * (та живёт в `StreakBadge`).
 */
export function goalProgress(solves: SolveRead[]): GoalProgress {
  const times = validTimes(solves);
  if (times.length === 0) {
    return { nextMs: null, bestMs: null, gapMs: null, holdMs: null, streakUnder: 0, stable: false };
  }

  const bestMs = Math.min(...times);
  const nextIndex = MILESTONES_MS.findIndex((ms) => bestMs >= ms);
  const nextMs = nextIndex === -1 ? null : MILESTONES_MS[nextIndex];
  // Пробитый рубеж — тот, что стоит в списке прямо перед следующим (список идёт
  // от медленного к быстрому). Все рубежи взяты -> закреплять последний из них.
  const holdMs =
    nextMs === null
      ? MILESTONES_MS[MILESTONES_MS.length - 1]
      : nextIndex === 0
        ? null
        : MILESTONES_MS[nextIndex - 1];

  const streakUnder = holdMs === null ? 0 : recentStreakUnder(times, holdMs);

  return {
    nextMs,
    bestMs,
    gapMs: nextMs === null ? null : bestMs - nextMs,
    holdMs,
    streakUnder,
    stable: holdMs !== null && streakUnder >= STREAK_TARGET,
  };
}

/** «sub-30», «sub-1:30» — как рубеж называют вслух. */
export function milestoneLabel(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `sub-${totalSec}`;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `sub-${mm}:${String(ss).padStart(2, "0")}`;
}
