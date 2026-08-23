// «Что дальше» после соло-сборки (карточка на ResultScreen). Чистые вычисления —
// сравнение с личным средним/рекордом и обновлённый прогресс к цели sub-N — без
// единого нового запроса: то же окно `listSolves(50)`, что уже грузят профиль
// (average.ts, goals.ts, SolveProgressChart), просто вызванное из соло-экрана
// (см. useSoloHistory).
//
// Среднее и рекорд считаются по истории ДО этой сборки (baseline — то, что
// useSoloHistory грузит в начале ритуала, ещё до старта таймера): иначе «побил
// рекорд» сравнивал бы попытку саму с собой. Цель (goalProgress), наоборот,
// считается С УЧЁТОМ текущей сборки — это то, где человек стоит ПРЯМО СЕЙЧАС,
// а не где он стоял до старта.

import type { SolveRead } from "../api/solves";
import { goalProgress, type GoalProgress } from "../profile/goals";

export interface NextCardModel {
  /** Есть ли хотя бы одна ЗАСЧИТАННАЯ сборка в истории ДО этой (baseline). */
  hasHistory: boolean;
  /** Личное среднее по baseline-истории, мс. null — истории нет. */
  averageMs: number | null;
  /** Личный рекорд ДО этой сборки, мс. null — истории нет. */
  recordMs: number | null;
  /** currentMs − averageMs: отрицательное значит быстрее среднего. null без сравнения. */
  vsAverageMs: number | null;
  /** Рекорд побит именно этой сборкой. */
  recordBeaten: boolean;
  /** Сколько осталось до рекорда, мс (>=0), если он НЕ побит. null иначе. */
  gapToRecordMs: number | null;
  /** На сколько рекорд побит, мс (>0). null, если не побит. */
  beatRecordByMs: number | null;
  /** Прогресс к цели sub-N с учётом этой сборки (см. profile/goals.ts). */
  goal: GoalProgress;
}

const CURRENT_SOLVE_ID = "__current-solve__";

function validTimes(solves: SolveRead[]): number[] {
  return solves.filter((s) => s.status === "valid").map((s) => s.time_ms);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Синтетическая запись, которая никуда не уходит по сети — нужна только чтобы
// goalProgress увидел эту сборку как часть истории (свежие сборки первыми).
function foldCurrentIn(history: SolveRead[], currentMs: number): SolveRead[] {
  return [
    {
      id: CURRENT_SOLVE_ID,
      scramble: "",
      time_ms: currentMs,
      status: "valid",
      verify_frames_ok: true,
      cube_id: null,
      scramble_id: null,
      created_at: new Date().toISOString(),
    },
    ...history,
  ];
}

/**
 * `history` — сборки ДО этой попытки, как их отдаёт `GET /solves` (свежие
 * первыми). `currentMs` — время этой сборки, мс; `null` для DNF (сравнивать
 * нечего — DNF не несёт настоящего времени).
 */
export function buildNextCard(history: SolveRead[], currentMs: number | null): NextCardModel {
  const priorValid = validTimes(history);
  const hasHistory = priorValid.length > 0;
  const averageMs = mean(priorValid);
  const recordMs = hasHistory ? Math.min(...priorValid) : null;

  const vsAverageMs = currentMs !== null && averageMs !== null ? currentMs - averageMs : null;
  const recordBeaten = currentMs !== null && recordMs !== null && currentMs < recordMs;
  const gapToRecordMs =
    !recordBeaten && currentMs !== null && recordMs !== null ? currentMs - recordMs : null;
  const beatRecordByMs =
    recordBeaten && recordMs !== null && currentMs !== null ? recordMs - currentMs : null;

  const goal = goalProgress(currentMs !== null ? foldCurrentIn(history, currentMs) : history);

  return {
    hasHistory,
    averageMs,
    recordMs,
    vsAverageMs,
    recordBeaten,
    gapToRecordMs,
    beatRecordByMs,
    goal,
  };
}
