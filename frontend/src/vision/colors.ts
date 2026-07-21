// Color science for cube reading. Pure functions only (no DOM), so they are unit
// testable under Vitest/node. Pipeline: sRGB -> Lab -> deltaE to 6 session refs
// -> global 9x6 quota assignment (center-pinned) -> validated facelet.

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

  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
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
  const SL =
    1 +
    (0.015 * Math.pow(Lbarp - 50, 2)) /
      Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
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

export interface QuotaResult {
  // 54 assigned color names, index i aligned with input labs[i].
  assignment: ColorName[];
  // true if every color ended with exactly QUOTA stickers.
  balanced: boolean;
  counts: Record<ColorName, number>;
}

/**
 * Greedy 9x6 assignment.
 *
 * Center stickers are UNAMBIGUOUS (a center never moves; its color IS the face
 * color), so we PIN the 6 centers to their color first and remove them from the
 * pool. Then we greedily assign the remaining 48: sort all (sticker,color) pairs
 * by deltaE ascending and take them cheapest-first, skipping any color whose
 * quota is exhausted and any sticker already placed.
 *
 * @param labs        54 sticker Lab colors.
 * @param refs        6 session references.
 * @param centerIdx   the 6 indices in `labs` that are centers, in COLOR_NAMES
 *                    order (centerIdx[k] is the center of COLOR_NAMES[k]).
 */
export function assignQuota(
  labs: Lab[],
  refs: Refs,
  centerIdx: number[],
  mode: DeltaEMode = config.DELTA_E_MODE,
  quota: number = config.QUOTA,
): QuotaResult {
  const n = labs.length;
  const assignment: (ColorName | null)[] = new Array(n).fill(null);
  const remaining: Record<ColorName, number> = {} as Record<ColorName, number>;
  for (const name of COLOR_NAMES) remaining[name] = quota;

  // Pin centers first.
  for (let k = 0; k < COLOR_NAMES.length; k++) {
    const idx = centerIdx[k];
    const name = COLOR_NAMES[k];
    assignment[idx] = name;
    remaining[name] -= 1;
  }

  // Build all (sticker, color) pairs for unpinned stickers, sorted by deltaE.
  const pinned = new Set(centerIdx);
  const pairs: { i: number; name: ColorName; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (pinned.has(i)) continue;
    for (const name of COLOR_NAMES) {
      pairs.push({ i, name, d: deltaE(labs[i], refs[name], mode) });
    }
  }
  pairs.sort((p, q) => p.d - q.d);

  for (const { i, name } of pairs) {
    if (assignment[i] !== null) continue;
    if (remaining[name] <= 0) continue;
    assignment[i] = name;
    remaining[name] -= 1;
  }

  const counts = {} as Record<ColorName, number>;
  for (const name of COLOR_NAMES) counts[name] = 0;
  for (const a of assignment) if (a) counts[a] += 1;

  const balanced = COLOR_NAMES.every((name) => counts[name] === quota);
  // Greedy CAN leave a sticker unassigned if a quota runs out; surface it.
  const complete = assignment.every((a) => a !== null);

  return {
    assignment: assignment.map((a) => a ?? COLOR_NAMES[0]),
    balanced: balanced && complete,
    counts,
  };
}
