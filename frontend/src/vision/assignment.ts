// Назначение с квотами: кто из наклеек какой цвет получает, если каждого цвета
// на кубике ровно девять.
//
// Модуль чистый (ни DOM, ни цветовой науки) — сюда приходит готовая матрица
// стоимостей, отсюда уходят индексы цветов. Цветом занимается colors.ts.

/**
 * Венгерский алгоритм (Кун — Манкрес в форме с потенциалами, e-maxx).
 * Совершенное паросочетание минимальной суммарной стоимости на квадратной
 * матрице; возвращает `col` для каждой строки.
 *
 * O(n³) при n = 48 — сто тысяч операций, доли миллисекунды. Это тот же порядок,
 * что уже платит сортировка 288 пар, поэтому «дорого» тут не бывает.
 *
 * `cost` обязан быть квадратным и конечным: бесконечность в матрице ломает
 * арифметику потенциалов (Infinity − Infinity = NaN). Запрет «этой строке нельзя
 * в этот столбец» выражается большим числом, а не Infinity.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  // Индексация с единицы: нулевые строка/столбец — служебные (стартовая
  // «свободная» вершина алгоритма), поэтому массивы на единицу длиннее.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // p[j] = строка, занявшая столбец j
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) rowToCol[p[j] - 1] = j - 1;
  }
  return rowToCol;
}

/**
 * Раздать `items` по группам с квотами так, чтобы СУММА стоимости была
 * минимальной. Возвращает индекс группы для каждого элемента (или null, если
 * элементу не хватило места: сумма квот меньше числа элементов).
 *
 * Зачем не жадно. Жадный обход «сначала самые дешёвые пары» смотрит на одну пару
 * за раз и не видит, чего лишает остальных. Больное место ровно то, из-за
 * которого квоты и введены — красный с оранжевым. Пусть остался один красный
 * слот и один оранжевый, а претендентов двое: наклейка X одинаково похожа на оба
 * (ΔE 5 и 6), наклейка Y — только на красный (ΔE 7 и 40). Жадный берёт самую
 * дешёвую пару X→красный, после чего Y достаётся оранжевый: суммарно 46. Оптимум
 * ставит X в оранжевый, Y в красный — 13, и обе наклейки прочитаны верно.
 * Жадный при этом ошибся ДВАЖДЫ, и обе ошибки — в паре red↔orange (R1).
 *
 * Как. Каждая единица квоты становится отдельным столбцом (девять красных
 * столбцов и т.д.), матрица добивается до квадратной и решается венгерским
 * алгоритмом. Внутри одной группы столбцы одинаковы, поэтому какой именно
 * достался — неважно; важно, сколько их всего, а это и есть квота.
 *
 * @param costs   costs[i][g] — цена отдать элемент i в группу g (конечное число)
 * @param quotas  сколько элементов принимает каждая группа
 */
export function minCostQuotaAssign(costs: number[][], quotas: number[]): (number | null)[] {
  const items = costs.length;
  if (items === 0) return [];

  // Столбец → группа. Группа с нулевой квотой столбцов не получает вовсе.
  const colGroup: number[] = [];
  for (let g = 0; g < quotas.length; g++) {
    for (let k = 0; k < Math.max(0, quotas[g]); k++) colGroup.push(g);
  }
  if (colGroup.length === 0) return new Array<number | null>(items).fill(null);

  // Квадратная матрица: недостающие строки/столбцы — пустышки ценой 0. Пустая
  // строка означает «этот слот никем не занят», пустой столбец — «этому элементу
  // места не хватило», и нулевая цена заставляет алгоритм выбрасывать за борт
  // самые дорогие пары, а не первые попавшиеся.
  const n = Math.max(items, colGroup.length);
  const square: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    if (i < items) {
      for (let j = 0; j < colGroup.length; j++) row[j] = costs[i][colGroup[j]];
    }
    square.push(row);
  }

  const rowToCol = hungarian(square);
  const out = new Array<number | null>(items).fill(null);
  for (let i = 0; i < items; i++) {
    const col = rowToCol[i];
    if (col >= 0 && col < colGroup.length) out[i] = colGroup[col];
  }
  return out;
}
