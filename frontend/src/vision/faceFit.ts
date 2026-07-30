// Подгонка сетки 3×3 под РЕАЛЬНОЕ положение грани в кадре.
//
// Зачем: раньше 3×3 нарезалось по жёлтой рамке, а рамка — это не кубик. Держишь
// чуть ближе, дальше или наискось — ячейки съезжают на щели между наклейками и
// на фон. Именно так белая наклейка читалась как красная: медиана бралась
// наполовину с чёрной щели и наполовину с наклейки соседнего цвета.
//
// Как: вместо распознавания контуров перебираем небольшой набор кандидатов
// (масштаб × сдвиг) и берём тот, чья сетка ЛУЧШЕ ВСЕГО ложится на наклейки.
// Оценка кандидата — не «похоже на квадрат», а прямо то, что нам нужно:
//   • каждая ячейка близка к одному из шести эталонов (фон и щели далеки);
//   • внутри ячейки цвет однороден (щель между наклейками даёт разброс);
//   • на границах ячеек есть тёмные щели — грань устроена как решётка.
// Поиск идёт по ОДНОМУ снятому патчу в памяти, без повторных draw — это десятки
// тысяч арифметических операций, доли миллисекунды.
//
// Про третий признак. Первых двух не хватает: «похожа на какой-нибудь эталон» —
// это ровно то, чем светлый фон (стол, стена, засвеченное окно) неотличим от
// белой наклейки. На живом кадре в кафе сетка спокойно съезжала вниз с кубика,
// нижний ряд читался как U, а стоимость кандидата оставалась низкой — подгонка
// считала такое положение отличным. Щели штрафовались, но только когда сетка
// села НА них; за то, что щели пришлись НА границы ячеек, никто не награждал.
// Решётка — признак самого кубика: у однотонной поверхности её нет ни при каком
// масштабе, поэтому фон дороже грани независимо от того, какого он цвета.

import { config } from "./config";
import { deltaE, median, rgb2lab, COLOR_NAMES, type Refs, type RGB } from "./colors";

export interface FitRegion {
  /** Левый верхний угол и сторона квадрата в координатах патча. */
  x: number;
  y: number;
  side: number;
}

export interface FitResult {
  region: FitRegion;
  /** Оценка выбранного кандидата (меньше — лучше). */
  cost: number;
  /** Оценка исходной (рамочной) области — для сравнения «стало/было». */
  baselineCost: number;
}

/** Патч: RGBA-пиксели квадратной области кадра. */
export interface Patch {
  data: Uint8ClampedArray | number[];
  size: number;
}

function cellStats(
  patch: Patch,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  centerFrac: number,
): { rgb: RGB; spread: number } {
  const mx = Math.floor((cw * (1 - centerFrac)) / 2);
  const my = Math.floor((ch * (1 - centerFrac)) / 2);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lumas: number[] = [];
  for (let y = y0 + my; y < y0 + ch - my; y++) {
    if (y < 0 || y >= patch.size) continue;
    for (let x = x0 + mx; x < x0 + cw - mx; x++) {
      if (x < 0 || x >= patch.size) continue;
      const i = (y * patch.size + x) * 4;
      const r = patch.data[i];
      const g = patch.data[i + 1];
      const b = patch.data[i + 2];
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  if (rs.length === 0) return { rgb: [0, 0, 0], spread: 255 };
  const medL = median(lumas);
  // Разброс — средний модуль отклонения яркости: щель между наклейками и край
  // кубика дают заметный разброс, ровная наклейка почти нулевой.
  let dev = 0;
  for (const l of lumas) dev += Math.abs(l - medL);
  return { rgb: [median(rs), median(gs), median(bs)], spread: dev / lumas.length };
}

const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Насколько ОДНА ячейка окантована тёмным, в единицах яркости 0..255.
 *
 * Признак поячеечный, а не на всю область, и это принципиально. Область целиком
 * ловит только грубые промахи: сетку на ровной поверхности и сдвиг на половину
 * ячейки. А живой отказ выглядел иначе — сетка съехала на ЦЕЛУЮ ячейку вниз, два
 * ряда остались на кубике, нижний ушёл на стол. Решётка при таком сдвиге не
 * ломается (щели совпали со следующими щелями), и признак на всю область такое
 * пропускает. Поячеечный — нет: ячейке на столе окантовки взять негде.
 *
 * Считается так: медиана яркости по каждой из четырёх полос, затем ВТОРАЯ С КОНЦА
 * из четырёх (не среднее и не худшая). Среднее не годится — ячейка на столе
 * вплотную к кубику получает одну тёмную полосу от его ребра, среднее уезжает
 * вниз, и ячейка выглядит окантованной. Худшая не годится в другую сторону: один
 * блик в щели зарубил бы правильную ячейку. Вторая с конца требует, чтобы тёмными
 * были минимум три стороны из четырёх.
 */
function cellGapContrast(
  patch: Patch,
  x0: number,
  y0: number,
  w: number,
  h: number,
  cellLuma: number,
  bandFrac: number,
): number {
  const halfW = Math.max(1, Math.round((w * bandFrac) / 2));
  const halfH = Math.max(1, Math.round((h * bandFrac) / 2));

  const bandMedian = (bx: number, by: number, bw: number, bh: number): number | null => {
    const lumas: number[] = [];
    for (let y = by; y < by + bh; y++) {
      if (y < 0 || y >= patch.size) continue;
      for (let x = bx; x < bx + bw; x++) {
        if (x < 0 || x >= patch.size) continue;
        const i = (y * patch.size + x) * 4;
        lumas.push(luma([patch.data[i], patch.data[i + 1], patch.data[i + 2]]));
      }
    }
    return lumas.length === 0 ? null : median(lumas);
  };

  const bands = [
    bandMedian(x0, y0 - halfH, w, 2 * halfH), // сверху
    bandMedian(x0, y0 + h - halfH, w, 2 * halfH), // снизу
    bandMedian(x0 - halfW, y0, 2 * halfW, h), // слева
    bandMedian(x0 + w - halfW, y0, 2 * halfW, h), // справа
  ].filter((v): v is number => v !== null);
  if (bands.length === 0) return 0;

  bands.sort((a, b) => a - b);
  return cellLuma - bands[Math.min(2, bands.length - 1)];
}

/**
 * Средний по 9 ячейкам контраст окантовки — диагностическая свёртка того же
 * признака, которым штрафуется кандидат в regionCost.
 */
export function gapContrast(
  patch: Patch,
  region: FitRegion,
  centerFrac = 0.5,
  bandFrac: number = config.FACE_FIT_GAP_BAND_FRAC,
): number {
  const cw = region.side / 3;
  let total = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      const cl = luma(cellStats(patch, x0, y0, w, h, centerFrac).rgb);
      total += cellGapContrast(patch, x0, y0, w, h, cl, bandFrac);
    }
  }
  return total / 9;
}

/** Стоимость кандидата: чем меньше, тем лучше сетка легла на наклейки. */
export function regionCost(
  patch: Patch,
  region: FitRegion,
  refs: Refs,
  centerFrac = 0.5,
  gapTarget: number = config.FACE_FIT_GAP_TARGET,
  gapWeight: number = config.FACE_FIT_GAP_WEIGHT,
  bandFrac: number = config.FACE_FIT_GAP_BAND_FRAC,
): number {
  const cw = region.side / 3;
  let total = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      const { rgb, spread } = cellStats(patch, x0, y0, w, h, centerFrac);
      const lab = rgb2lab(rgb);
      let best = Infinity;
      for (const name of COLOR_NAMES) best = Math.min(best, deltaE(lab, refs[name]));
      // Недобор окантовки. Насыщается на gapTarget: у белой наклейки щели темнее
      // её на сотню единиц, у синей — на десятки, и штрафовать синюю нельзя.
      const deficit = Math.max(
        0,
        gapTarget - cellGapContrast(patch, x0, y0, w, h, luma(rgb), bandFrac),
      );
      // ΔE до ближайшего эталона — основная часть; разброс внутри ячейки —
      // добавка, которая штрафует сетку, севшую на щели.
      total += best + spread * 0.35 + deficit * gapWeight;
    }
  }
  return total / 9;
}

/** Кандидаты: масштаб грани внутри патча × сдвиг по обеим осям. */
export function candidateRegions(patchSize: number): FitRegion[] {
  const out: FitRegion[] = [];
  for (const scale of [0.62, 0.72, 0.82, 0.92, 1.0]) {
    const side = patchSize * scale;
    const slack = patchSize - side;
    const steps = slack < 2 ? [0] : [0, 0.25, 0.5, 0.75, 1];
    for (const fx of steps) {
      for (const fy of steps) {
        out.push({ x: slack * fx, y: slack * fy, side });
      }
    }
  }
  return out;
}

/**
 * Найти квадрат грани внутри патча.
 *
 * `baseline` — область, которую взяли бы без подгонки (весь патч, если рамка и
 * есть предполагаемая грань). Возвращается вместе с оценкой, чтобы вызывающий
 * мог решить, доверять ли подгонке: если выигрыш крошечный, дешевле остаться на
 * прежней геометрии, чем дёргать сетку от кадра к кадру.
 */
export function fitFaceRegion(patch: Patch, refs: Refs, centerFrac = 0.5): FitResult {
  const baseline: FitRegion = { x: 0, y: 0, side: patch.size };
  const baselineCost = regionCost(patch, baseline, refs, centerFrac);

  let best = baseline;
  let bestCost = baselineCost;
  for (const cand of candidateRegions(patch.size)) {
    const cost = regionCost(patch, cand, refs, centerFrac);
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return { region: best, cost: bestCost, baselineCost };
}
