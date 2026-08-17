// Физика кубика: насколько прочитанное состояние ПОХОЖЕ на настоящий кубик.
//
// Зачем отдельно от `cubeState.validateFacelets`. Тот отвечает «да/нет»: легально
// состояние или нет. Для сборки это правильно, для ЗАМЕРА — бесполезно: одна
// неверно прочитанная наклейка делает нелегальной любую комбинацию поворотов, и
// чтение с двумя ошибками не отличить от чтения с двадцатью. Гейту же нужно
// оценивать именно несовершенные чтения — иначе он умеет ставить только 100% или
// «брак».
//
// Поэтому здесь МЯГКАЯ мера: сколько физических ограничений нарушено. Она
// монотонна (чем хуже чтение, тем больше нарушений) и, главное, НИЧЕГО не знает
// про ожидаемый скрамбл — поэтому по ней можно выравнивать грани, не подгоняя
// под ответ.
//
// Какие ограничения. У настоящего кубика 8 угловых и 12 рёберных кубиков:
//   - у угла ровно по одной наклейке из каждой пары противоположных цветов
//     (U/D, R/L, F/B): бело-красно-зелёный существует, бело-жёлтого не бывает;
//   - у ребра две наклейки из РАЗНЫХ пар: бело-красное есть, бело-жёлтого нет;
//   - каждый угловой и каждый рёберный кубик встречается ровно один раз.
// Счётчики цветов (по 9 на цвет) сюда НЕ входят намеренно: поворот грани не
// меняет мультимножество цветов, значит для выбора поворота этот признак —
// константа и различить кандидатов не может.

import { FACE_ORDER, type Face, type Facelet } from "./cubeState";

/**
 * Индексы наклеек восьми угловых кубиков в строке URFDLB
 * (U 0-8, R 9-17, F 18-26, D 27-35, L 36-44, B 45-53).
 */
export const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20], // URF
  [6, 18, 38], // UFL
  [0, 36, 47], // ULB
  [2, 45, 11], // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];

/** Индексы наклеек двенадцати рёберных кубиков в той же строке. */
export const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [5, 10], // UR
  [7, 19], // UF
  [3, 37], // UL
  [1, 46], // UB
  [32, 16], // DR
  [28, 25], // DF
  [30, 43], // DL
  [34, 52], // DB
  [23, 12], // FR
  [21, 41], // FL
  [50, 39], // BL
  [48, 14], // BR
];

/** Пара противоположных граней для каждого цвета. */
const OPPOSITE: Record<Face, Face> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

/** Ключ «пары осей»: наклейки одной оси не могут делить один кубик. */
function axisOf(f: Face): string {
  return f < OPPOSITE[f] ? `${f}${OPPOSITE[f]}` : `${OPPOSITE[f]}${f}`;
}

export interface PhysicsViolations {
  /** Углы, у которых не по одной наклейке с каждой оси. */
  badCorners: number;
  /** Рёбра, у которых обе наклейки с одной оси (или одинаковы). */
  badEdges: number;
  /** Повторы: один и тот же угловой/рёберный кубик встретился дважды. */
  duplicates: number;
  /** Сумма — то, что минимизируется при выборе поворотов. */
  total: number;
}

/**
 * Сколько физических ограничений нарушает данное состояние. 0 — состояние
 * состоит из настоящих кубиков (это ещё НЕ полная легальность: чётности не
 * проверяются, для них есть `validateFacelets`).
 */
export function countPhysicsViolations(s: Facelet): PhysicsViolations {
  let badCorners = 0;
  let badEdges = 0;
  const seenCorners = new Set<string>();
  const seenEdges = new Set<string>();
  let duplicates = 0;

  for (const [a, b, c] of CORNER_FACELETS) {
    const trio = [s[a], s[b], s[c]] as Face[];
    const axes = new Set(trio.map(axisOf));
    if (axes.size !== 3) {
      badCorners += 1;
      continue; // повтор считаем только у физически возможных углов
    }
    const key = [...trio].sort().join("");
    if (seenCorners.has(key)) duplicates += 1;
    seenCorners.add(key);
  }

  for (const [a, b] of EDGE_FACELETS) {
    const pair = [s[a], s[b]] as Face[];
    if (axisOf(pair[0]) === axisOf(pair[1])) {
      badEdges += 1;
      continue;
    }
    const key = [...pair].sort().join("");
    if (seenEdges.has(key)) duplicates += 1;
    seenEdges.add(key);
  }

  return { badCorners, badEdges, duplicates, total: badCorners + badEdges + duplicates };
}

/** Счётчики цветов — диагностика на сторону, в выбор поворота не идут. */
export function colorCountPenalty(s: Facelet): number {
  const counts: Record<string, number> = {};
  for (const ch of s) counts[ch] = (counts[ch] ?? 0) + 1;
  let penalty = 0;
  for (const f of FACE_ORDER) penalty += Math.abs((counts[f] ?? 0) - 9);
  return penalty;
}
