// Текущий Ao5 из уже загруженной истории профиля. Правила те же, что на сервере
// (`backend/app/services/averages.py`), но считаются здесь ради ОДНОГО числа
// «сейчас» — рекорд Ao5 приходит с сервера в `user.best_ao5_ms`.
//
// Дублирование правил осознанное и узкое: обе стороны покрыты тестами на одних
// и тех же примерах (одна DNF — просто отброшенная худшая, две DNF — DNF всего
// среднего). Альтернатива — ещё один эндпоинт ради строки в карточке.

import type { SolveRead } from "../api/solves";

export const AVERAGE_SIZE = 5;

/** Ao5 по ровно пяти попыткам; `null` в списке — DNF. */
export function ao5(times: (number | null)[]): number | null {
  if (times.length !== AVERAGE_SIZE) return null;
  const dnfs = times.filter((t) => t === null).length;
  if (dnfs >= 2) return null;

  const finished = times.filter((t): t is number => t !== null).sort((a, b) => a - b);
  // Одна DNF — это и есть отброшенная худшая; иначе режем и лучшую, и худшую.
  const counted = dnfs === 1 ? finished.slice(1) : finished.slice(1, -1);
  return Math.round(counted.reduce((sum, t) => sum + t, 0) / counted.length);
}

/**
 * Ao5 по пяти последним попыткам из истории (`GET /solves`, новые первыми).
 *
 * `rejected` — не попытка (ритуал не соблюдён), поэтому пропускается целиком,
 * а не считается DNF-ом.
 */
export function currentAo5(solves: SolveRead[]): number | null {
  const attempts = solves
    .filter((s) => s.status === "valid" || s.status === "dnf")
    .slice(0, AVERAGE_SIZE)
    .map((s) => (s.status === "dnf" ? null : s.time_ms));
  return ao5(attempts);
}
