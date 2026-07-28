// Повороты кубика целиком (24 ориентации) над строкой фаселетов URFDLB.
//
// Зачем: сверка «собрал ли ты показанный скрамбл» сравнивала прочитанное
// состояние с эталоном в ОДНОЙ фиксированной ориентации (белый верх, зелёный к
// себе). Человек же берёт кубик как удобно и крутит его в руках — то же самое
// состояние тогда записывается другой строкой, и сверка показывала «расходится
// 36 наклеек» при физически правильном скрамбле. Это была не ошибка цвета:
// состояние совпадало с точностью до поворота всего кубика.
//
// Решение: сравнивать с точностью до 24 ориентаций. Здесь — генерация этих 24
// вариантов эталона; выбор лучшего живёт в cubeGrid.
//
// Как считается: у каждой наклейки есть 3D-позиция её центра на кубике 3×3×3.
// Поворот кубика — это поворот пространства; наклейка едет в позицию, которой
// соответствует другой индекс строки. Матрицы поворотов перебираются как все
// собственные повороты куба (детерминант +1), поэтому таблица индексов не
// вбита руками и не может «поехать» на одной грани.

export const FACELETS = 54;

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;

/**
 * Центр наклейки (face, row, col) в целочисленных координатах.
 *
 * Вдоль нормали грани берётся ±3, поперёк — {-1,0,1}. Вынос по нормали
 * обязателен: без него три наклейки одного углового кубика получили бы ОДНУ
 * точку (±1,±1,±1), перестановка схлопнулась бы с 54 позиций до 27 и повороты
 * поехали бы. Масштаб 3 оставляет координаты целыми — ключи сравниваются точно,
 * без плавающей арифметики.
 */
function stickerPosition(faceIndex: number, r: number, c: number): Vec {
  switch (FACE_ORDER[faceIndex]) {
    case "U":
      return [c - 1, 3, r - 1];
    case "R":
      return [3, 1 - r, 1 - c];
    case "F":
      return [c - 1, 1 - r, 3];
    case "D":
      return [c - 1, -3, 1 - r];
    case "L":
      return [-3, 1 - r, c - 1];
    case "B":
      return [1 - c, 1 - r, -3];
  }
}

function positionsByIndex(): Vec[] {
  const out: Vec[] = [];
  for (let f = 0; f < 6; f++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) out.push(stickerPosition(f, r, c));
    }
  }
  return out;
}

function apply(m: Mat, v: Vec): Vec {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function det(m: Mat): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Все 24 собственных поворота куба как знаковые перестановочные матрицы. */
function rotationMatrices(): Mat[] {
  const axes: Vec[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const out: Mat[] = [];
  for (const i of [0, 1, 2]) {
    for (const j of [0, 1, 2]) {
      if (j === i) continue;
      const k = 3 - i - j;
      for (const si of [1, -1]) {
        for (const sj of [1, -1]) {
          for (const sk of [1, -1]) {
            const m: Mat = [
              axes[i].map((v) => v * si) as Vec,
              axes[j].map((v) => v * sj) as Vec,
              axes[k].map((v) => v * sk) as Vec,
            ];
            if (det(m) === 1) out.push(m);
          }
        }
      }
    }
  }
  return out;
}

function key(v: Vec): string {
  return `${v[0]},${v[1]},${v[2]}`;
}

/**
 * Перестановки индексов для всех 24 ориентаций: `PERMUTATIONS[k][i]` — откуда
 * взять символ, чтобы получить i-й символ повёрнутой строки.
 */
export const PERMUTATIONS: number[][] = (() => {
  const positions = positionsByIndex();
  const byPos = new Map<string, number>();
  positions.forEach((p, i) => byPos.set(key(p), i));

  return rotationMatrices().map((m) => {
    const perm = new Array<number>(FACELETS);
    for (let i = 0; i < FACELETS; i++) {
      const moved = apply(m, positions[i]);
      const dst = byPos.get(key(moved));
      if (dst === undefined) throw new Error("rotation left the cube — bad matrix");
      perm[dst] = i;
    }
    return perm;
  });
})();

/** Одна ориентация строки фаселетов. `k` — индекс в `PERMUTATIONS`. */
export function rotateFacelets(facelets: string, k: number): string {
  const perm = PERMUTATIONS[k];
  let out = "";
  for (let i = 0; i < FACELETS; i++) out += facelets[perm[i]];
  return out;
}

/** Все 24 ориентации состояния — то же состояние, записанное иначе. */
export function orientationVariants(facelets: string): string[] {
  return PERMUTATIONS.map((_, k) => rotateFacelets(facelets, k));
}
