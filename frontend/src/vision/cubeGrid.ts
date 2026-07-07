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

import { deltaE, COLOR_NAMES, type Lab, type ColorName, type Refs } from "./colors";
import { validateFacelets, FACE_ORDER, type Face, type Facelet } from "./cubeState";

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
export function assignFacesByCenter(
  faceGridsLab: Lab[][],
  refs: Refs,
): { faces: Face[]; ok: boolean; reason?: string } {
  const faces: Face[] = [];
  for (const grid of faceGridsLab) {
    const center = grid[4];
    let best: ColorName = COLOR_NAMES[0];
    let bestD = Infinity;
    for (const name of COLOR_NAMES) {
      const d = deltaE(center, refs[name]);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    faces.push(best as Face);
  }
  // Each of the 6 faces must appear exactly once.
  const counts: Record<string, number> = {};
  for (const f of faces) counts[f] = (counts[f] ?? 0) + 1;
  for (const f of FACE_ORDER) {
    if (counts[f] !== 1) {
      return {
        faces,
        ok: false,
        reason: `face ${f} assigned ${counts[f] ?? 0}x by center color (need exactly 1) — re-capture / check light`,
      };
    }
  }
  return { faces, ok: true };
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

export function resolveRotations(
  faceGrids: Face[][],
  faceOf: Face[],
): RotationResolution {
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
