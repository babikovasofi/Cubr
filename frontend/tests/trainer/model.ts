// Test-only cube oracle for the PLL trainer's test battery. NOT shipped:
// lives under tests/, never imported from src/trainer or src/pages, so cubejs
// never re-enters the /trainer runtime chunk (the whole point of "construction,
// not search" — see the plan's Design decisions → "No runtime cube model").
//
// Reuses vision/cubeState.ts (SOLVED, validateFacelets) and
// vision/faceletRotations.ts (orientationVariants) rather than re-deriving a
// cube model. cubejs's raw cp/ep permutation arrays (ambient-typed in
// vision/cubejs.d.ts, test-oracle use only) are what let us derive PLL cycles
// independently of any algorithm string — see llSignature below.

import Cube from "cubejs";
import { SOLVED, validateFacelets, type Facelet } from "../../src/vision/cubeState";
import { orientationVariants } from "../../src/vision/faceletRotations";

/** All-U-face-rotations: the four ways an algorithm can be finished off. */
export const AUFS = ["", "U", "U2", "U'"] as const;

// Last-layer position labels, in cubejs's own Kociemba index order (corners:
// URF,UFL,ULB,UBR,...; edges: UR,UF,UL,UB,...) — see node_modules/cubejs
// lib/cube.js's own [URF, UFL, ULB, UBR, ...] constant list. Only positions
// 0..3 of cp/ep ever move for a PLL case (OLL solved, F2L intact keeps the
// other 4 corners / 8 edges fixed).
export const CORNER_POS = ["UFR", "UFL", "ULB", "UBR"] as const;
export const EDGE_POS = ["UR", "UF", "UL", "UB"] as const;
export type CornerPos = (typeof CORNER_POS)[number];
export type EdgePos = (typeof EDGE_POS)[number];

/**
 * Test-oracle inverse: reverse token order, flip each token's direction
 * (`R`<->`R'`, `R2` stays `R2`). Works uniformly for face/slice/rotation
 * tokens (U R F D L B M E S x y z) since they all share the same `'`/`2`
 * suffix convention. Used by pllTable.test.ts (step 4) to build each case's
 * defining state — needed before src/trainer/generate.ts's own (separate,
 * shipped-runtime) `invertAlg` exists per the plan's step order.
 */
export function invertAlg(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((tok) => {
      const face = tok[0];
      const suffix = tok.slice(1);
      if (suffix === "'") return face;
      if (suffix === "2") return `${face}2`;
      return `${face}'`;
    })
    .join(" ");
}

/** Apply a move sequence to a facelet string, cubejs-notation. Empty string is a no-op
 * (cubejs's own move() does not accept an empty token list). */
export function applyMoves(facelets: Facelet, alg: string): Facelet {
  if (!alg.trim()) return facelets;
  const c = Cube.fromString(facelets);
  c.move(alg);
  return c.asString();
}

/**
 * Re-label a whole-cube-rotated facelets string back to identity centers, by
 * reading each of the 6 center stickers and mapping whatever color sits there
 * back to that slot's canonical face letter. Same trick used in
 * vision/faceletRotations.test.ts to prove "any grip" states are still legal
 * cubes — needed here because `validateFacelets`/cp/ep extraction require
 * identity centers, and a state built with an orientation prefix (x/y/z) does
 * not have them.
 */
export function normalizeCenters(facelets: Facelet): Facelet {
  const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;
  const relabel: Record<string, string> = {};
  FACE_ORDER.forEach((slot, i) => {
    relabel[facelets[i * 9 + 4]] = slot;
  });
  return facelets
    .split("")
    .map((ch) => relabel[ch])
    .join("");
}

function cornerPerm4(facelets: Facelet): number[] {
  return Cube.fromString(facelets).cp.slice(0, 4);
}

function edgePerm4(facelets: Facelet): number[] {
  return Cube.fromString(facelets).ep.slice(0, 4);
}

/** perm4[i] = which piece currently sits at position i (0..3, over `labels`).
 * Returns cycle notation: piece that started at cycle[k] is now at cycle[k+1]
 * (wrapping) — i.e. cycles of the INVERSE permutation, which is "where did
 * each named position's original occupant go", the natural way a human reads
 * a PLL diagram ("UFR goes to UBR goes to ULB"). Fixed points are omitted. */
export function cyclesFromPerm4<L extends string>(perm4: number[], labels: readonly L[]): L[][] {
  const n = labels.length;
  const invPerm = new Array<number>(n);
  for (let i = 0; i < n; i++) invPerm[perm4[i]] = i;
  const seen = new Array(n).fill(false);
  const cycles: L[][] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || invPerm[start] === start) continue;
    const cyc: L[] = [];
    let cur = start;
    while (!seen[cur]) {
      seen[cur] = true;
      cyc.push(labels[cur]);
      cur = invPerm[cur];
    }
    cycles.push(cyc);
  }
  return cycles;
}

/** Inverse of `cyclesFromPerm4`: rebuilds a raw perm4 array from declared
 * cycle notation. Positions absent from every cycle are fixed points. Used to
 * turn a table row's independently-authored cornerCycle/edgeCycle back into a
 * permutation WITHOUT ever touching an algorithm — this is what lets
 * pllCompleteness.test.ts validate the spec before any `alg` field exists. */
export function permFromCycles<L extends string>(cycles: L[][], labels: readonly L[]): number[] {
  const idx = (l: L) => labels.indexOf(l);
  const invPerm = labels.map((_, i) => i);
  for (const cyc of cycles) {
    for (let k = 0; k < cyc.length; k++) {
      invPerm[idx(cyc[k])] = idx(cyc[(k + 1) % cyc.length]);
    }
  }
  const perm = new Array<number>(labels.length);
  for (let i = 0; i < labels.length; i++) perm[invPerm[i]] = i;
  return perm;
}

export interface LlSignature {
  cornerCycles: CornerPos[][];
  edgeCycles: EdgePos[][];
}

/** The independent structural fingerprint of a last-layer state: which
 * corners/edges cycle among themselves, and in which direction. Derived
 * purely from cubejs's cp/ep permutation arrays — never from an algorithm
 * string. */
export function llSignature(facelets: Facelet): LlSignature {
  return {
    cornerCycles: cyclesFromPerm4(cornerPerm4(facelets), CORNER_POS),
    edgeCycles: cyclesFromPerm4(edgePerm4(facelets), EDGE_POS),
  };
}

function rawKey(cp4: number[], ep4: number[]): string {
  return cp4.join(",") + "|" + ep4.join(",");
}

// SHIFT is the position-permutation a single `U` turn induces on the 4
// last-layer corner/edge slots (verified empirically against cubejs: applying
// "U" to any state maps position i's occupant to whatever sat at (i+3)%4 —
// see the model's dev notes). Post-multiplying a state by U^j (trailing AUF)
// therefore reindexes the array itself: postShift(perm)[i] = perm[(i+3)%4].
// Pre-multiplying by U^i (prepending a U turn to whatever algorithm reached
// this state) instead relabels which PIECE occupies a position, since the
// extra U turn is applied to a solved cube before the rest of the moves run:
// preShift(perm)[i] = SHIFT[perm[i]]. Both were confirmed against cubejs
// directly (apply "U <alg>" vs "<alg>" and compare cp/ep) rather than assumed.
const SHIFT = [3, 0, 1, 2];

function postShiftPerm(perm4: number[]): number[] {
  return perm4.map((_, i) => perm4[(i + 3) % 4]);
}

function preShiftPerm(perm4: number[]): number[] {
  return perm4.map((v) => SHIFT[v]);
}

/**
 * AUF-and-lead-in-invariant key for a raw (corner-perm4, edge-perm4) pair: the
 * lexicographically smallest `rawKey` among the 16 `U^i · state · U^j`
 * variants (i, j ∈ 0..3). This is the group-theoretically correct notion of
 * "the same named PLL case": post-multiply alone (4-way) only accounts for a
 * trailing AUF, but a single memorized algorithm also solves any state
 * reachable by prepending a U turn before executing it (the classic "AUF
 * before you start" recognition move) — folding in pre-multiply too is what
 * collapses the 288 legal last-layer states down to exactly 22 classes (1
 * solved + 21 PLL), matching the well-established PLL case count.
 *
 * Works on bare permutation arrays (no cube/facelets involved) specifically
 * so `pllCompleteness.test.ts` can validate the table's cornerCycle/edgeCycle
 * spec before a single `alg` string exists — see `permFromCycles`.
 */
export function canonicalSignatureFromPerm(cp4: number[], ep4: number[]): string {
  const keys: string[] = [];
  let preCp = cp4;
  let preEp = ep4;
  for (let i = 0; i < 4; i++) {
    let postCp = preCp;
    let postEp = preEp;
    for (let j = 0; j < 4; j++) {
      keys.push(rawKey(postCp, postEp));
      postCp = postShiftPerm(postCp);
      postEp = postShiftPerm(postEp);
    }
    preCp = preShiftPerm(preCp);
    preEp = preShiftPerm(preEp);
  }
  return keys.sort()[0];
}

/** `canonicalSignatureFromPerm`, reading cp/ep straight off a facelets string. */
export function canonicalSignature(facelets: Facelet): string {
  return canonicalSignatureFromPerm(cornerPerm4(facelets), edgePerm4(facelets));
}

/** Same PLL case, irrespective of AUF and of which U-aligned view it's recognized from. */
export function sameCaseUpToAuf(a: Facelet, b: Facelet): boolean {
  return canonicalSignature(a) === canonicalSignature(b);
}

/**
 * Same PLL case irrespective of AUF AND of which of the 24 orientations the
 * cube was physically held in (the "any grip" mode). `a` may carry an
 * orientation prefix (so its centers are not necessarily identity); `b` is
 * assumed already canonical/identity-centered. Tries all 24 rotations of `a`,
 * re-identifying centers for each before comparing — mirrors the
 * relabel-by-center approach `lenientVerify` uses for the same "held
 * differently" problem (vision/faceletRotations.test.ts).
 */
export function sameCaseUpToAufAndOrientation(a: Facelet, b: Facelet): boolean {
  const target = canonicalSignature(b);
  return orientationVariants(a).some((variant) => {
    const normalized = normalizeCenters(variant);
    return validateFacelets(normalized).ok && canonicalSignature(normalized) === target;
  });
}

export { SOLVED, validateFacelets };
