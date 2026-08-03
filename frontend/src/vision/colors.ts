// Color science for cube reading. Pure functions only (no DOM), so they are unit
// testable under Vitest/node. Pipeline: sRGB -> Lab -> deltaE to 6 session refs
// -> global 9x6 quota assignment (center-pinned) -> validated facelet.

import { minCostQuotaAssign } from "./assignment";
import { config, type DeltaEMode } from "./config";

export type RGB = [number, number, number]; // 0..255
export type Lab = [number, number, number]; // L 0..100, a/b roughly -128..127

// The six cube face colors. Names, not RGB — the actual RGB is learned per
// session via calibration (that is the whole point of P1 layer 1).
export type ColorName = "U" | "R" | "F" | "D" | "L" | "B";
export const COLOR_NAMES: ColorName[] = ["U", "R", "F", "D", "L", "B"];

// ---------------------------------------------------------------------------
// sRGB -> CIE Lab (D65)
// ---------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

export function rgb2lab([r, g, b]: RGB): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // Linear sRGB -> XYZ (D65)
  let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

  // Normalize by D65 reference white
  x /= 0.95047;
  y /= 1.0;
  z /= 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  return [L, a, bb];
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/**
 * Inverse of {@link rgb2lab}: CIE Lab (D65) -> sRGB, clamped to 0..255. Used only
 * to render stored colour-profile swatches; not part of the read pipeline.
 */
export function lab2rgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const fInv = (t: number) => (t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787);
  const xr = fInv(fx);
  const yr = fInv(fy);
  const zr = fInv(fz);

  const x = xr * 0.95047;
  const y = yr * 1.0;
  const z = zr * 1.08883;

  const rl = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const gl = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const bl = x * 0.0557 + y * -0.204 + z * 1.057;

  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

// ---------------------------------------------------------------------------
// deltaE: CIE76 (fallback) and CIEDE2000 (default)
// ---------------------------------------------------------------------------

export function deltaE76(a: Lab, b: Lab): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

const deg2rad = (d: number) => (d * Math.PI) / 180;
const rad2deg = (r: number) => (r * 180) / Math.PI;

// CIEDE2000 per Sharma, Wu & Dalal (2005), the standard implementation.
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = hpF(b1, a1p);
  const h2p = hpF(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  const dhp = dhpF(C1p, C2p, h1p, h2p);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  const hbarp = aHpF(C1p, C2p, h1p, h2p);

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hbarp - 30)) +
    0.24 * Math.cos(deg2rad(2 * hbarp)) +
    0.32 * Math.cos(deg2rad(3 * hbarp + 6)) -
    0.2 * Math.cos(deg2rad(4 * hbarp - 63));

  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(deg2rad(2 * dtheta)) * RC;

  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );
}

function hpF(b: number, ap: number): number {
  if (b === 0 && ap === 0) return 0;
  const h = rad2deg(Math.atan2(b, ap));
  return h >= 0 ? h : h + 360;
}

function dhpF(C1p: number, C2p: number, h1p: number, h2p: number): number {
  if (C1p * C2p === 0) return 0;
  const diff = h2p - h1p;
  if (Math.abs(diff) <= 180) return diff;
  return diff > 180 ? diff - 360 : diff + 360;
}

function aHpF(C1p: number, C2p: number, h1p: number, h2p: number): number {
  if (C1p * C2p === 0) return h1p + h2p;
  if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
  if (h1p + h2p < 360) return (h1p + h2p + 360) / 2;
  return (h1p + h2p - 360) / 2;
}

export function deltaE(a: Lab, b: Lab, mode: DeltaEMode = config.DELTA_E_MODE): number {
  return mode === "cie76" ? deltaE76(a, b) : deltaE2000(a, b);
}

// ---------------------------------------------------------------------------
// Median of the central region of a cell (blows past glare + border bleed)
// ---------------------------------------------------------------------------

/**
 * Median RGB over the central `centerFrac` region of a WxH block of RGBA pixels.
 * `pixels` is a flat RGBA array (like ImageData.data) of size w*h*4.
 */
/**
 * Устойчивый цвет ячейки: медиана по центру ячейки, но БЕЗ бликов и теней.
 *
 * Зачем: обычная медиана по центральным 50% ловит блик от лампы (пересвеченное
 * пятно почти всегда бело-жёлтое) и тень от пальца. В багрепорте белая наклейка
 * читалась как красная/оранжевая — ровно этот механизм: часть ячейки выбита в
 * пересвет, часть затенена, медиана уезжает.
 *
 * Как: берём яркость каждого пикселя, считаем медианную яркость ячейки и
 * оставляем только пиксели в коридоре вокруг неё, дополнительно выкидывая
 * заведомо выбитые (яркость выше `blownLuma`). Если после отбраковки осталось
 * слишком мало — возвращаем медиану по всему центру и честно сообщаем низкую
 * долю `kept`: вызывающий может переспросить грань вместо того, чтобы гадать.
 */
export interface RobustCell {
  rgb: RGB;
  /** Доля пикселей, переживших отбраковку (0..1). Низкая — ячейка ненадёжна. */
  kept: number;
}

export function robustCellColor(
  pixels: Uint8ClampedArray | number[],
  w: number,
  h: number,
  centerFrac: number = config.CELL_CENTER_FRAC,
  lumaTol: number = config.CELL_LUMA_TOLERANCE,
  blownLuma: number = config.CELL_BLOWN_LUMA,
): RobustCell {
  const marginX = Math.floor((w * (1 - centerFrac)) / 2);
  const marginY = Math.floor((h * (1 - centerFrac)) / 2);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lumas: number[] = [];
  for (let y = marginY; y < h - marginY; y++) {
    for (let x = marginX; x < w - marginX; x++) {
      const i = (y * w + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  if (rs.length === 0) return { rgb: [0, 0, 0], kept: 0 };

  const medLuma = median(lumas);
  const keepR: number[] = [];
  const keepG: number[] = [];
  const keepB: number[] = [];
  for (let i = 0; i < rs.length; i++) {
    if (lumas[i] > blownLuma) continue;
    if (Math.abs(lumas[i] - medLuma) > lumaTol) continue;
    keepR.push(rs[i]);
    keepG.push(gs[i]);
    keepB.push(bs[i]);
  }
  const kept = keepR.length / rs.length;
  if (keepR.length < rs.length * config.CELL_MIN_KEPT_FRAC) {
    // Отбраковка съела почти всё (сплошной пересвет или мимо кубика) — отдаём
    // сырую медиану, но с честным низким `kept`.
    return { rgb: [median(rs), median(gs), median(bs)], kept };
  }
  return { rgb: [median(keepR), median(keepG), median(keepB)], kept };
}

export function medianOfCentralRegion(
  pixels: Uint8ClampedArray | number[],
  w: number,
  h: number,
  centerFrac: number = config.CELL_CENTER_FRAC,
): RGB {
  const marginX = Math.floor((w * (1 - centerFrac)) / 2);
  const marginY = Math.floor((h * (1 - centerFrac)) / 2);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = marginY; y < h - marginY; y++) {
    for (let x = marginX; x < w - marginX; x++) {
      const i = (y * w + x) * 4;
      rs.push(pixels[i]);
      gs.push(pixels[i + 1]);
      bs.push(pixels[i + 2]);
    }
  }
  return [median(rs), median(gs), median(bs)];
}

/** Поячеечная медиана нескольких снимков одной грани (9 ячеек × N кадров). */
export function medianAcrossFrames(frames: RGB[][]): RGB[] {
  if (frames.length === 0) return [];
  const cells = frames[0].length;
  const out: RGB[] = [];
  for (let c = 0; c < cells; c++) {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (const frame of frames) {
      const px = frame[c];
      if (!px) continue;
      rs.push(px[0]);
      gs.push(px[1]);
      bs.push(px[2]);
    }
    out.push([median(rs), median(gs), median(bs)]);
  }
  return out;
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Session calibration: 6 solved faces -> 6 reference Lab colors
// ---------------------------------------------------------------------------

export type Refs = Record<ColorName, Lab>;

/**
 * Build the 6 session reference colors. `faceMedians` maps each color name to
 * the median RGB of that solved face's center (or whole face — caller decides).
 */
export function calibrate(faceMedians: Record<ColorName, RGB>): Refs {
  const refs = {} as Refs;
  for (const name of COLOR_NAMES) {
    refs[name] = rgb2lab(faceMedians[name]);
  }
  return refs;
}

// Canonical Lab anchors for the standard colour scheme (white top / green front:
// U=white, R=red, F=green, D=yellow, L=orange, B=blue). The 6 cube colours are
// far apart, so matching captured colours to these anchors is robust even under a
// global white-balance/exposure shift (a shifted red is still nearer red than
// green). Used to LABEL the 6 calibration faces by their actual colour instead of
// by the order they were shown in.
const COLOR_ANCHORS: Record<ColorName, Lab> = {
  U: [92, 0, 2], // white
  R: [50, 60, 40], // red
  F: [52, -45, 25], // green
  D: [85, -10, 75], // yellow
  L: [62, 45, 58], // orange
  B: [32, 15, -45], // blue
};

/**
 * Order-INDEPENDENT calibration. Given the 6 captured face-center RGBs in ANY
 * order, assign each to its face slot (U/R/F/D/L/B) by its actual colour — a
 * minimum-cost bijection between the 6 captured Labs and the 6 canonical anchors
 * (brute force over 6! = 720 permutations, trivially cheap, globally optimal).
 *
 * This fixes the "faces shown in the wrong order → refs mislabeled → every read
 * lands in the wrong slot" failure: the user can show the 6 faces in any order.
 * `capturedRGB` MUST have exactly 6 entries (one per solved face).
 */
export function calibrateByColorIdentity(capturedRGB: RGB[]): Refs {
  if (capturedRGB.length !== COLOR_NAMES.length) {
    throw new Error(`calibrateByColorIdentity needs 6 colours, got ${capturedRGB.length}`);
  }
  const labs = capturedRGB.map(rgb2lab);
  const n = COLOR_NAMES.length;

  // Best permutation perm[faceIndex] = captured index, minimizing total anchor ΔE.
  const used = new Array(n).fill(false);
  const current: number[] = [];
  let bestCost = Infinity;
  let bestPerm: number[] = [];

  const recurse = (faceIdx: number, cost: number): void => {
    if (cost >= bestCost) return; // prune
    if (faceIdx === n) {
      bestCost = cost;
      bestPerm = current.slice();
      return;
    }
    const anchor = COLOR_ANCHORS[COLOR_NAMES[faceIdx]];
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      used[c] = true;
      current.push(c);
      recurse(faceIdx + 1, cost + deltaE76(labs[c], anchor));
      current.pop();
      used[c] = false;
    }
  };
  recurse(0, 0);

  const refs = {} as Refs;
  for (let f = 0; f < n; f++) refs[COLOR_NAMES[f]] = labs[bestPerm[f]];
  return refs;
}

/** ΔE от каждого снятого эталона до канонного анкора своего цвета. */
export function anchorDistances(
  refs: Refs,
  mode: DeltaEMode = config.DELTA_E_MODE,
): Record<ColorName, number> {
  const out = {} as Record<ColorName, number>;
  for (const name of COLOR_NAMES) out[name] = deltaE(refs[name], COLOR_ANCHORS[name], mode);
  return out;
}

/** Минимальное попарное ΔE между шестью эталонами и сама пара. */
export function minSeparation(
  refs: Refs,
  mode: DeltaEMode = config.DELTA_E_MODE,
): { de: number; a: ColorName; b: ColorName } {
  let best = { de: Infinity, a: COLOR_NAMES[0], b: COLOR_NAMES[1] };
  for (let i = 0; i < COLOR_NAMES.length; i++) {
    for (let j = i + 1; j < COLOR_NAMES.length; j++) {
      const de = deltaE(refs[COLOR_NAMES[i]], refs[COLOR_NAMES[j]], mode);
      if (de < best.de) best = { de, a: COLOR_NAMES[i], b: COLOR_NAMES[j] };
    }
  }
  return best;
}

export type CalibrationProblem =
  | { kind: "white-not-lightest"; whiteL: number; lightest: ColorName; lightestL: number }
  | { kind: "collapsed"; a: ColorName; b: ColorName; de: number };

/**
 * Годен ли набор из шести эталонов, чтобы по нему вообще читать цвета.
 *
 * Замок нужен потому, что раскладка по цветам (calibrateByColorIdentity) НИКОГДА
 * не отказывает: она берёт шесть снятых цветов и раздаёт им шесть слотов по
 * ближайшему анкору. Снял руку вместо белой грани — телесный цвет всё равно
 * ближе к белому, чем к остальным пяти, и молча занимает слот U. Ровно это и
 * случилось на живом прогоне: U снялся как RGB(215,174,161), после чего белые
 * наклейки читались красными, а точность падала до 39% на пустом месте.
 *
 * Проверка НЕ по расстоянию до анкора. На живых замерах у рабочих калибровок
 * синий стоял в 22 единицах от своего анкора, а испорченный белый — в 18: порог,
 * который поймал бы белый, зарубил бы рабочие прогоны. Работает структурный
 * инвариант: белая наклейка — самая светлая из шести при любом освещении. У
 * испорченного набора она оказалась на 12 единиц темнее жёлтой, у рабочих —
 * светлее всех. `slack` оставляет запас на шум, потому что у рабочего прогона
 * отрыв белого от жёлтой был всего одна единица.
 *
 * Второй замок — на полностью слипшихся эталонах, когда камера не различает
 * цвета вообще. Порог намеренно низкий: на живой вебкамере красный с оранжевым
 * расходятся всего на 16–17, и блок по «различимости ≥20» сделал бы продукт
 * неработающим там, где сырое чтение доходило до 65%.
 */
export function checkCalibration(
  refs: Refs,
  slack: number = config.CALIB_WHITE_LIGHTNESS_SLACK,
  minSepDE: number = config.CALIB_MIN_SEPARATION_DE,
  mode: DeltaEMode = config.DELTA_E_MODE,
): CalibrationProblem | null {
  const whiteL = refs.U[0];
  let lightest: ColorName = "R";
  for (const name of COLOR_NAMES) {
    if (name === "U") continue;
    if (refs[name][0] > refs[lightest][0]) lightest = name;
  }
  if (whiteL < refs[lightest][0] - slack) {
    return { kind: "white-not-lightest", whiteL, lightest, lightestL: refs[lightest][0] };
  }

  const sep = minSeparation(refs, mode);
  if (sep.de < minSepDE) return { kind: "collapsed", a: sep.a, b: sep.b, de: sep.de };
  return null;
}

/** Independent per-sticker classification (argmin deltaE). No quota. */
export function classifyFace(
  cellLabs: Lab[],
  refs: Refs,
  mode: DeltaEMode = config.DELTA_E_MODE,
): ColorName[] {
  return cellLabs.map((lab) => {
    let best: ColorName = COLOR_NAMES[0];
    let bestD = Infinity;
    for (const name of COLOR_NAMES) {
      const d = deltaE(lab, refs[name], mode);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  });
}

// ---------------------------------------------------------------------------
// Quick-adjust: one-WHITE-face session white-balance (multiplicative von-Kries)
//
// Skeptic HIGH#1: the correction is a per-channel MULTIPLICATIVE gain applied in
// LINEAR-sRGB (lab→rgb→linearize→×gain→delinearize→lab), NOT an additive Lab
// offset. An additive Lab shift is a rigid translation → every pairwise ΔE is
// preserved → any convergence gate computed on the refs would be a no-op. See
// the regression test in colors.test.ts. The "converged" decision here is taken
// on the OBSERVED white face (cluster tightness + single-ref match margin,
// HIGH#2/#3), never on the shifted refs.
// ---------------------------------------------------------------------------

// Per-channel linear-sRGB (0..1) of an sRGB triplet, and back to 0..255 sRGB.
function linRGB([r, g, b]: RGB): [number, number, number] {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
function delinRGB([r, g, b]: [number, number, number]): RGB {
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

// Gain is clamped so a near-black/blown white channel can't produce a runaway
// factor that warps every ref past recognition.
const GAIN_MIN = 0.25;
const GAIN_MAX = 4;
const clampGain = (g: number): number => Math.min(GAIN_MAX, Math.max(GAIN_MIN, g));

/**
 * Per-channel von-Kries gain in linear-sRGB mapping the profile's white (refWhite,
 * i.e. refs.U under calibration light A) onto the observed white under the current
 * light B. gain = observedWhiteLinear / refWhiteLinear.
 */
export function vonKriesGain(observedWhite: RGB, refWhite: Lab): [number, number, number] {
  const wObs = linRGB(observedWhite);
  const wRef = linRGB(lab2rgb(refWhite));
  return [
    clampGain(wObs[0] / Math.max(wRef[0], 1e-4)),
    clampGain(wObs[1] / Math.max(wRef[1], 1e-4)),
    clampGain(wObs[2] / Math.max(wRef[2], 1e-4)),
  ];
}

function applyGainToRef(ref: Lab, g: [number, number, number]): Lab {
  const lin = linRGB(lab2rgb(ref));
  return rgb2lab(delinRGB([lin[0] * g[0], lin[1] * g[1], lin[2] * g[2]]));
}

/** Apply a linear-sRGB per-channel gain to all six refs (session-local white-balance). */
export function applyVonKries(refs: Refs, g: [number, number, number]): Refs {
  const out = {} as Refs;
  for (const name of COLOR_NAMES) out[name] = applyGainToRef(refs[name], g);
  return out;
}

/**
 * Пер-грань нормировка света по её собственному центру.
 *
 * Эталоны снимаются один раз на калибровке, а свет плывёт: солнце уходит, рука
 * бросает тень, камера подкручивает баланс белого. Центр наклейки не двигается
 * НИКОГДА, поэтому его цвет — известная точка отсчёта именно для этой грани:
 * зная, каким он должен быть, считаем канальный коэффициент (фон-Крис в
 * линейном sRGB) и применяем ко всем девяти ячейкам этой грани.
 *
 * Возвращает исправленные RGB. Коэффициент зажат `clampGain`, поэтому
 * промах в опознании центра не может вывернуть грань наизнанку.
 */
export function normalizeFaceByCenter(faceRGB: RGB[], centerRef: Lab): RGB[] {
  if (faceRGB.length !== 9) return faceRGB;
  const observedCenter = faceRGB[4];
  const gain = vonKriesGain(observedCenter, centerRef);
  // Коэффициент считался «наблюдаемое / эталон», значит для исправления
  // наблюдаемого к эталонному свету его надо применить в обратную сторону.
  const inverse: [number, number, number] = [1 / gain[0], 1 / gain[1], 1 / gain[2]];
  return faceRGB.map((rgb) => applyLightGain(rgb, inverse));
}

/** Simulate a global illuminant change: linear-sRGB per-channel gain on an sRGB color. */
export function applyLightGain(rgb: RGB, g: [number, number, number]): RGB {
  const lin = linRGB(rgb);
  return delinRGB([lin[0] * g[0], lin[1] * g[1], lin[2] * g[2]]);
}

// The observed-face stats + the quick-adjust decision (gate order, convergence)
// live in ./quickAdjust to keep this module focused on core colour primitives.

// ---------------------------------------------------------------------------
// 9x6 quota assignment (the P1 layer-3 constraint)
// ---------------------------------------------------------------------------

/**
 * Насколько можно верить цвету ячейки, из доли выживших пикселей (`kept`).
 *
 * Полное доверие начинается там же, где кончается брак: `CELL_MIN_KEPT_FRAC` —
 * порог, ниже которого ячейка уже считается негодной в `confidentCells`. Ниже
 * порога доверие падает пропорционально, но не до нуля: у ячейки всё же есть
 * цвет, просто шумный, а нулевой вес сделал бы её невидимой для оптимизации —
 * она уехала бы в первый попавшийся слот вместо ближайшего по смыслу.
 */
export function cellWeight(kept: number, minKept: number = config.CELL_MIN_KEPT_FRAC): number {
  if (!Number.isFinite(kept)) return 1;
  if (kept >= minKept) return 1;
  const scaled = minKept > 0 ? kept / minKept : 1;
  return Math.max(config.CELL_WEIGHT_MIN, Math.min(1, scaled));
}

export interface QuotaResult {
  // 54 assigned color names, index i aligned with input labs[i].
  assignment: ColorName[];
  // true if every color ended with exactly QUOTA stickers.
  balanced: boolean;
  counts: Record<ColorName, number>;
}

/**
 * Назначение 9×6 с МИНИМАЛЬНОЙ СУММАРНОЙ стоимостью (не жадное).
 *
 * Центры однозначны — центр никогда не двигается, его цвет и ЕСТЬ цвет грани, —
 * поэтому шесть центров пиннятся первыми и выходят из розыгрыша. Остальные 48
 * раздаются по оставшимся квотам целиком, одним решением: венгерский алгоритм на
 * матрице «наклейка × цвето-слот» (см. assignment.minCostQuotaAssign).
 *
 * Раньше здесь был жадный обход пар по возрастанию ΔE. Он смотрит на одну пару
 * за раз и не видит, чего лишает остальных: наклейка, которой красный и
 * оранжевый почти безразличны, съедает последний красный слот, а та, которой
 * красный нужен позарез, уезжает в оранжевый. Две ошибки вместо нуля, и обе — в
 * паре red↔orange, то есть ровно в R1, ради которого квоты и заведены. Оптимум
 * такого размена не делает по построению: суммарная стоимость его решения не
 * бывает хуже жадной ни на одной колоде.
 *
 * `weights` — насколько можно верить цвету каждой наклейки (1 — полностью).
 * Стоимости ненадёжной наклейки умножаются на её вес, то есть её предпочтения
 * стоят дешевле: при споре за последний красный слот выигрывает та наклейка,
 * чей цвет измерен честно, а выбитая бликом довольствуется остатком. Раньше
 * блик спорил за слот на равных с чистым чтением и мог его отобрать.
 *
 * @param labs        54 sticker Lab colors.
 * @param refs        6 session references.
 * @param centerIdx   the 6 indices in `labs` that are centers, in COLOR_NAMES
 *                    order (centerIdx[k] is the center of COLOR_NAMES[k]).
 * @param weights     надёжность каждой наклейки 0..1 (по умолчанию все единицы).
 */
export function assignQuota(
  labs: Lab[],
  refs: Refs,
  centerIdx: number[],
  mode: DeltaEMode = config.DELTA_E_MODE,
  quota: number = config.QUOTA,
  weights?: number[],
): QuotaResult {
  const n = labs.length;
  const assignment: (ColorName | null)[] = new Array(n).fill(null);
  const remaining: Record<ColorName, number> = {} as Record<ColorName, number>;
  for (const name of COLOR_NAMES) remaining[name] = quota;

  // Pin centers first. Индекс вне массива игнорируем: центр, которого нет, не
  // должен ни занимать квоту, ни ронять раздачу остальных.
  const pinned = new Set<number>();
  for (let k = 0; k < COLOR_NAMES.length; k++) {
    const idx = centerIdx[k];
    if (idx === undefined || idx < 0 || idx >= n || pinned.has(idx)) continue;
    const name = COLOR_NAMES[k];
    assignment[idx] = name;
    remaining[name] -= 1;
    pinned.add(idx);
  }

  // Матрица стоимостей только для неприпиннованных наклеек.
  const freeIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!pinned.has(i)) freeIdx.push(i);
  const costs = freeIdx.map((i) => {
    const w = weights?.[i] ?? 1;
    return COLOR_NAMES.map((name) => deltaE(labs[i], refs[name], mode) * w);
  });
  const groups = minCostQuotaAssign(
    costs,
    COLOR_NAMES.map((name) => remaining[name]),
  );
  for (let f = 0; f < freeIdx.length; f++) {
    const g = groups[f];
    if (g === null) continue;
    const name = COLOR_NAMES[g];
    assignment[freeIdx[f]] = name;
    remaining[name] -= 1;
  }

  const counts = {} as Record<ColorName, number>;
  for (const name of COLOR_NAMES) counts[name] = 0;
  for (const a of assignment) if (a) counts[a] += 1;

  const balanced = COLOR_NAMES.every((name) => counts[name] === quota);
  // Наклеек может оказаться больше, чем мест (54 против 6×9 сходится, но входы
  // бывают и другими) — тогда кто-то остаётся ни с чем; сообщаем об этом.
  const complete = assignment.every((a) => a !== null);

  return {
    assignment: assignment.map((a) => a ?? COLOR_NAMES[0]),
    balanced: balanced && complete,
    counts,
  };
}
