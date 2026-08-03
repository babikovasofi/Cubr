// Pure cube grid + auto-orientation logic (extracted from the prototype's cube.ts;
// the canvas readers readFace/guideRegionLuma live in hooks/useCubeReader.ts).
//
// AUTO-ORIENTATION (plan #6) is two independent steps:
//   (a) assignFacesByCenter — each capture's CENTER sticker color (argmin deltaE
//       vs the 6 refs) names WHICH face (U/R/F/D/L/B) that capture is. A center
//       is a solid color: it names the face but carries NO in-plane rotation.
//   (b) resolveRotations — the in-plane rotation (0/90/180/270) of each face is
//       recovered by GLOBAL CONSISTENCY: brute-force all 4^6 rotation combos,
//       assemble the 54-char URFDLB string, and keep the combo cubejs accepts as
//       a LEGAL cube. Ambiguous / none legal -> FAIL LOUD (re-capture).

import { hungarian } from "./assignment";
import { deltaE, COLOR_NAMES, type Lab, type ColorName, type Refs } from "./colors";
import { config } from "./config";
import { orientationVariants } from "./faceletRotations";
import { validateFacelets, type Face, type Facelet } from "./cubeState";

// ---- Grid rotation helpers -------------------------------------------------

// Rotate a 9-element row-major 3x3 grid clockwise by 90 degrees.
export function rotateCW(grid: number[]): number[] {
  // src index -> dst: (r,c) -> (c, 2-r)
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[c * 3 + (2 - r)] = grid[r * 3 + c];
    }
  }
  return out;
}

/** Rotate any 9-element grid by k*90 degrees clockwise (k = 0..3). */
export function rotateGrid<T>(grid: T[], k: number): T[] {
  let g = grid.slice();
  const n = ((k % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    const out = new Array(9) as T[];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) out[c * 3 + (2 - r)] = g[r * 3 + c];
    }
    g = out;
  }
  return g;
}

/**
 * Rotate a single captured face by k quarter-turns (0..3), CW. Thin wrapper kept
 * for callers/tests that already picked a rotation (e.g. from resolveRotations).
 */
export function normalizeByRotation<T>(grid: T[], k = 0): T[] {
  return rotateGrid(grid, k);
}

// ---- Auto-orientation (plan #6) -------------------------------------------

/**
 * (a) Face assignment by CENTER color. For each captured face grid, classify its
 * center sticker (cell 4) against the 6 session refs by argmin deltaE. Returns
 * the face letter (U/R/F/D/L/B) each capture represents. A center color names
 * the face but carries NO in-plane rotation — that is step (b).
 *
 * `faceGridsLab[c]` is one capture's 9 Lab cells (row-major). Returns one Face
 * per capture, plus `ambiguous` if two captures classify to the same face
 * (means the tester duplicated a face or lighting is wrong -> FAIL LOUD).
 */
export interface CenterAssignment {
  faces: Face[];
  ok: boolean;
  reason?: string;
  /** Какая съёмка провалила замок: её номер (с нуля), выданный цвет и ΔE до него. */
  offender?: { capture: number; face: Face; de: number };
  /**
   * ΔE каждой съёмки до выданного ей цвета и медиана по шести. Нужны наружу:
   * одно число «40.8» одинаково выглядит и когда в рамку попал стол, и когда
   * свет уехал у всей сессии разом, а лечится это по-разному.
   */
  centerDEs: number[];
  medianDE: number;
}

export function assignFacesByCenter(faceGridsLab: Lab[][], refs: Refs): CenterAssignment {
  const centers = faceGridsLab.map((grid) => grid[4]);

  // Шесть съёмок и шесть цветов — это бижекция, и раздавать её надо целиком.
  // Независимый argmin по каждому центру этого не знает: стоит красному центру
  // оказаться на волос ближе к оранжевому эталону, как оранжевый достаётся
  // дважды, а красный — ни разу, и всё чтение бракуется, хотя человек показал
  // ровно то, что просили. Минимальная по сумме раскладка такого не делает: если
  // цвета вообще различимы, каждый получает свою грань. Тот же приём уже стоит в
  // calibrateByColorIdentity — там раскладываются шесть эталонов, здесь шесть
  // съёмок.
  if (faceGridsLab.length !== COLOR_NAMES.length) {
    return {
      faces: centers.map((lab) => nearestRef(lab, refs) as Face),
      ok: false,
      reason: `got ${faceGridsLab.length} captures, need exactly ${COLOR_NAMES.length} — re-capture`,
      centerDEs: [],
      medianDE: 0,
    };
  }

  const cost = centers.map((lab) => COLOR_NAMES.map((name) => deltaE(lab, refs[name])));
  const pick = hungarian(cost);
  const faces = pick.map((colorIdx) => COLOR_NAMES[colorIdx] as Face);
  const centerDEs = pick.map((colorIdx, c) => cost[c][colorIdx]);
  const medianDE = medianOf(centerDEs);

  // Замок против подгонки под ответ. Раскладка НИКОГДА не отказывает: покажи одну
  // грань дважды — второй съёмке всё равно достанется какой-нибудь свободный
  // цвет, и вместо честного «покажи шестую грань» человек получил бы уверенно
  // неверное чтение.
  //
  // Замок ОТНОСИТЕЛЬНЫЙ, и это не мягкость. Абсолютный порог путает две разные
  // болезни: свет, уехавший у всей сессии разом (тучи ушли, камера подкрутила
  // экспозицию), двигает ВСЕ шесть центров примерно одинаково — цвета при этом
  // по-прежнему различимы, и чтение имеет смысл; а стол или рука в рамке
  // выбивает ОДНУ съёмку из общей картины. Медиана по шести — это и есть «общая
  // картина», поэтому ловим отрыв от неё. Абсолютный потолок остаётся вторым
  // рубежом: за ним центр уже не похож ни на что, сдвинулась сессия или нет.
  for (let c = 0; c < faces.length; c++) {
    const de = centerDEs[c];
    const outlier = de - medianDE > config.CENTER_OUTLIER_DE;
    if (outlier || de > config.CENTER_MAX_DELTA_E) {
      return {
        faces,
        ok: false,
        reason: outlier
          ? `capture ${c + 1} centre is ${de.toFixed(1)} from the ${faces[c]} colour while the other captures sit around ${medianDE.toFixed(1)} — that one capture is not a cube face`
          : `capture ${c + 1} centre is ${de.toFixed(1)} away from the ${faces[c]} colour (max ${config.CENTER_MAX_DELTA_E}) — the light moved far from calibration`,
        offender: { capture: c, face: faces[c], de },
        centerDEs,
        medianDE,
      };
    }
  }
  return { faces, ok: true, centerDEs, medianDE };
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function nearestRef(lab: Lab, refs: Refs): ColorName {
  let best: ColorName = COLOR_NAMES[0];
  let bestD = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaE(lab, refs[name]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * (b) Resolve each face's in-plane rotation by GLOBAL CONSISTENCY.
 *
 * Input: 6 captured face grids of FACE LETTERS (already classified per-sticker to
 * U/R/F/D/L/B), tagged with WHICH face each is (from assignFacesByCenter). Each
 * face may be off by an unknown quarter turn (0/90/180/270). We brute-force all
 * 4^6 = 4096 rotation combos, assemble the 54-char URFDLB string for each, and
 * accept the combo(s) cubejs validates as a LEGAL cube.
 *
 *  - exactly one legal combo  -> return it (the recovered orientation).
 *  - zero legal combos        -> FAIL LOUD (bad read / re-capture).
 *  - more than one legal combo -> AMBIGUOUS, FAIL LOUD (do not guess).
 *
 * @param faceGrids  faceGrids[c] = 9 face-letters (row-major) of the c-th capture
 * @param faceOf     faceOf[c]    = which Face that capture is (from step a)
 */
export interface RotationResolution {
  ok: boolean;
  reason?: string;
  rotations?: number[]; // per-capture k (0..3), aligned with faceGrids
  facelets?: Facelet; // assembled legal URFDLB string
}

/**
 * CASUAL-solo lenient match (NOT for ranked). The strict resolveRotations demands
 * a globally-legal cube: a single misread sticker makes every rotation combo
 * illegal and the whole read is rejected (the R1 pain the accuracy gate measures).
 *
 * For casual solo we instead score the REAL per-sticker read against the expected
 * facelets, face by face: assign each captured face to a slot by its center color,
 * pick the rotation (0..3) that best matches that slot's 9 expected stickers, and
 * count mismatches. The caller accepts if the correct fraction clears
 * CASUAL_VERIFY_MIN_CORRECT_FRAC. A wildly wrong cube still fails (structural
 * differences dwarf colour noise); a correctly-scrambled cube with a few misreads
 * passes. Honesty tradeoff is explicit and confined to casual solo.
 *
 * @param faceGrids  faceGrids[c] = 9 per-sticker face-letters (row-major) of capture c
 * @param faceOf     faceOf[c]    = which Face capture c is (center-color assignment)
 * @param expected   54-char URFDLB expected facelets
 */
export interface LenientMatch {
  totalStickers: number; // always 54 for a full 6-face read
  mismatches: number; // 0..totalStickers
  worstFace: Face; // face contributing the most mismatches
  worstCount: number; // its mismatch count (0..9)
}

function matchAgainst(faceGrids: Face[][], faceOf: Face[], expected: Facelet): LenientMatch {
  const slotOf: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const expSlots: Face[][] = [];
  for (let i = 0; i < 6; i++) {
    expSlots.push(expected.slice(i * 9, (i + 1) * 9).split("") as Face[]);
  }
  let total = 0;
  let mismatches = 0;
  let worstFace: Face = "U";
  let worstCount = -1;
  for (let cap = 0; cap < faceGrids.length; cap++) {
    const exp = expSlots[slotOf[faceOf[cap]]];
    let bestHamming = 9;
    for (let k = 0; k < 4; k++) {
      const rotated = rotateGrid(faceGrids[cap], k);
      let h = 0;
      for (let j = 0; j < 9; j++) if (rotated[j] !== exp[j]) h++;
      if (h < bestHamming) bestHamming = h;
    }
    total += 9;
    mismatches += bestHamming;
    if (bestHamming > worstCount) {
      worstCount = bestHamming;
      worstFace = faceOf[cap];
    }
  }
  return { totalStickers: total, mismatches, worstFace, worstCount };
}

export function lenientVerify(
  faceGrids: Face[][],
  faceOf: Face[],
  expected: Facelet,
): LenientMatch {
  // Сверяем С ТОЧНОСТЬЮ ДО ПОВОРОТА ВСЕГО КУБИКА (24 ориентации эталона).
  //
  // Без этого честно собранный скрамбл давал «расходится 36 наклеек»: человек
  // держит кубик как удобно и крутит его в руках, а эталон записан в одной
  // фиксированной ориентации (белый верх, зелёный к себе). Пофейсовый поворот
  // 0/90/180/270 такую разницу не покрывает — там переезжают и сами грани.
  //
  // Цена: 24 варианта × 6 граней × 4 поворота × 9 наклеек ≈ 5к сравнений, то
  // есть доли миллисекунды один раз на чтение.
  let best: LenientMatch | null = null;
  for (const variant of orientationVariants(expected)) {
    const m = matchAgainst(faceGrids, faceOf, variant as Facelet);
    if (best === null || m.mismatches < best.mismatches) best = m;
    if (best.mismatches === 0) break;
  }
  return best!;
}

export function resolveRotations(faceGrids: Face[][], faceOf: Face[]): RotationResolution {
  if (faceGrids.length !== 6 || faceOf.length !== 6) {
    return { ok: false, reason: `need 6 faces, got ${faceGrids.length}` };
  }
  // Map each Face letter to its slot in the assembled URFDLB string.
  const slotOf: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

  const legal: { rotations: number[]; facelets: Facelet }[] = [];
  const rot = new Array(6).fill(0);

  // 4^6 combos.
  for (let combo = 0; combo < 4096; combo++) {
    let c = combo;
    for (let i = 0; i < 6; i++) {
      rot[i] = c & 3;
      c >>= 2;
    }
    // Assemble the 54-char string in URFDLB slot order.
    const slots: (Face[] | null)[] = new Array(6).fill(null);
    for (let capture = 0; capture < 6; capture++) {
      const slot = slotOf[faceOf[capture]];
      slots[slot] = rotateGrid(faceGrids[capture], rot[capture]);
    }
    if (slots.some((s) => s === null)) continue; // duplicate face slot
    const s = slots.map((g) => (g as Face[]).join("")).join("");
    if (validateFacelets(s).ok) {
      legal.push({ rotations: rot.slice(), facelets: s });
      if (legal.length > 1) break; // ambiguous — stop early
    }
  }

  if (legal.length === 0) {
    return { ok: false, reason: "no rotation combo yields a legal cube — re-capture" };
  }
  if (legal.length > 1) {
    return { ok: false, reason: "ambiguous: multiple rotation combos are legal — re-capture" };
  }
  return { ok: true, rotations: legal[0].rotations, facelets: legal[0].facelets };
}
