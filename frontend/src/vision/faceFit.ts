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
//   • внутри ячейки цвет однороден (щель между наклейками даёт разброс).
// Поиск идёт по ОДНОМУ снятому патчу в памяти, без повторных draw — это десятки
// тысяч арифметических операций, доли миллисекунды.

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

/** Стоимость кандидата: чем меньше, тем лучше сетка легла на наклейки. */
export function regionCost(patch: Patch, region: FitRegion, refs: Refs, centerFrac = 0.5): number {
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
      // ΔE до ближайшего эталона — основная часть; разброс внутри ячейки —
      // добавка, которая штрафует сетку, севшую на щели.
      total += best + spread * 0.35;
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
