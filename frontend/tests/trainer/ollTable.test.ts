// Per-case structure (S1-S6) and identity (I1-I2) battery for the OLL table
// — mirrors pllTable.test.ts's role. Every case is checked against
// `state = applyMoves(SOLVED, invertAlg(alg))`: this is the case's OWN
// definition, so these are the tests that actually catch a wrong/mistyped
// algorithm — S1-S6 catch it not being a legal OLL-only state at all, I1-I2
// catch it landing on the WRONG (or a duplicate) case.
//
// One check pllTable.test.ts has that this file deliberately does NOT: an
// "LL permutation is identity" assertion. Real OLL algorithms are free to
// permute the last layer while fixing orientation (PLL cleans up afterward
// regardless) — every one of these 57 standard algorithms does, in fact,
// leave a non-identity permutation when run from solved. See oll.ts's
// header for why this was checked empirically, not assumed, while building
// the table.

import { describe, it, expect } from "vitest";
import {
  applyMoves,
  invertAlg,
  ollSignature,
  canonicalOllSignature,
  SOLVED,
  validateFacelets,
  AUFS,
} from "./model";
import { OLL_CASES, type OllCase } from "../../src/trainer/oll";

const D_FACE = SOLVED.slice(27, 36); // D face never touches the last layer
function sideBottomTwoRows(facelets: string, faceStart: number): string {
  return facelets.slice(faceStart + 3, faceStart + 9);
}
const F_START = 18;
const R_START = 9;
const L_START = 36;
const B_START = 45;

function normalizeTwists(entries: readonly { pos: string; twist: number }[]): string {
  return entries
    .map((e) => `${e.pos}:${e.twist}`)
    .sort()
    .join(",");
}
function normalizeFlips(flips: readonly string[]): string {
  return flips.slice().sort().join(",");
}

describe.each(OLL_CASES)("ollTable [$id $name]", (c: OllCase) => {
  const state = applyMoves(SOLVED, invertAlg(c.alg));

  it("S1: algorithm parses without throwing", () => {
    expect(() => applyMoves(SOLVED, c.alg)).not.toThrow();
  });

  it("S2: centers are identity — no stray whole-cube rotation", () => {
    const centers = [4, 13, 22, 31, 40, 49];
    const faces = ["U", "R", "F", "D", "L", "B"];
    centers.forEach((idx, i) => expect(state[idx]).toBe(faces[i]));
  });

  it("S3: everything outside the last layer matches SOLVED — F2L intact", () => {
    expect(state.slice(27, 36)).toBe(D_FACE);
    expect(sideBottomTwoRows(state, F_START)).toBe(sideBottomTwoRows(SOLVED, F_START));
    expect(sideBottomTwoRows(state, R_START)).toBe(sideBottomTwoRows(SOLVED, R_START));
    expect(sideBottomTwoRows(state, L_START)).toBe(sideBottomTwoRows(SOLVED, L_START));
    expect(sideBottomTwoRows(state, B_START)).toBe(sideBottomTwoRows(SOLVED, B_START));
  });

  it("S4: at least one U-face sticker is NOT 'U' — this is an OLL, not solved-orientation", () => {
    expect(state.slice(0, 9)).not.toBe("UUUUUUUUU");
  });

  it("S5: state is not solved, and isn't an AUF-of-solved either", () => {
    expect(state).not.toBe(SOLVED);
    for (const auf of AUFS) {
      expect(state).not.toBe(applyMoves(SOLVED, auf));
    }
  });

  it("S6: state is a legal, solvable cube (reuses validateFacelets)", () => {
    expect(validateFacelets(state).ok).toBe(true);
  });

  it("I1: orientation derived from the state (canonicalized by AUF) equals the declared cornerTwist/edgeFlip", () => {
    const declaredKey = normalizeTwists(c.cornerTwist) + "|" + normalizeFlips(c.edgeFlip);
    const matchesSomeAuf = AUFS.some((auf) => {
      const sig = ollSignature(applyMoves(state, auf));
      const computed = normalizeTwists(sig.cornerTwist) + "|" + normalizeFlips(sig.edgeFlip);
      return computed === declaredKey;
    });
    expect(matchesSomeAuf).toBe(true);
  });

  it("alg applied to state returns exactly to solved (the case's own definition)", () => {
    expect(applyMoves(state, c.alg)).toBe(SOLVED);
  });
});

describe("ollTable — cross-case identity", () => {
  it("I2: all 57 canonical signatures are pairwise distinct", () => {
    const sigs = OLL_CASES.map((c) => canonicalOllSignature(applyMoves(SOLVED, invertAlg(c.alg))));
    expect(new Set(sigs).size).toBe(57);
  });
});
