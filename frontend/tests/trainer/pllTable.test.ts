// Per-case structure (S1-S6) and identity (I1-I4) battery — see the plan's
// Test plan section. Every case is checked against `state =
// applyMoves(SOLVED, invertAlg(alg))`: this is the case's OWN definition
// (Design decisions -> "Generation approach"), so these tests are the ones
// that actually catch a wrong/mistyped algorithm — S1-S6 catch it not being a
// legal PLL-only state at all, I1-I2 catch it landing on the WRONG (or a
// duplicate) case.

import { describe, it, expect } from "vitest";
import {
  applyMoves,
  invertAlg,
  llSignature,
  canonicalSignature,
  SOLVED,
  validateFacelets,
  AUFS,
} from "./model";
import { PLL_CASES, type PllCase } from "../../src/trainer/pll";

const D_FACE = SOLVED.slice(27, 36); // D face never touches the last layer
function sideBottomTwoRows(facelets: string, faceStart: number): string {
  // rows 2 and 3 (indices 3..8) of a face — the two rows away from U.
  return facelets.slice(faceStart + 3, faceStart + 9);
}
const F_START = 18;
const R_START = 9;
const L_START = 36;
const B_START = 45;

/** Canonicalize a cycle list for order/rotation-independent comparison:
 * rotate each cycle to start at its lexicographically smallest label, then
 * sort the cycles themselves. */
function normalizeCycles<L extends string>(cycles: L[][]): string {
  return cycles
    .map((cyc) => {
      let best = cyc;
      for (let k = 0; k < cyc.length; k++) {
        const rotated = [...cyc.slice(k), ...cyc.slice(0, k)];
        if (rotated.join(",") < best.join(",")) best = rotated;
      }
      return best.join(",");
    })
    .sort()
    .join("|");
}

describe.each(PLL_CASES)("pllTable [$id]", (c: PllCase) => {
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

  it("S4: all 9 U-face stickers are 'U' — this is a PLL, not an OLL", () => {
    expect(state.slice(0, 9)).toBe("UUUUUUUUU");
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

  it("I1: cycles derived from the state (canonicalized by AUF) equal the declared cycles", () => {
    const declared = normalizeCycles<string>([...c.cornerCycle, ...c.edgeCycle]);
    const matchesSomeAuf = AUFS.some((auf) => {
      const sig = llSignature(applyMoves(state, auf));
      const computed = normalizeCycles<string>([...sig.cornerCycles, ...sig.edgeCycles]);
      return computed === declared;
    });
    expect(matchesSomeAuf).toBe(true);
  });

  it("I3: applying alg `order` times (from solved) returns to solved; order-1 times does not", () => {
    // Starting from `state` itself would be trivial (1 application always
    // solves it, by the case's own definition) — order is a property of the
    // algorithm as a group element, so it's measured applying `alg` to
    // SOLVED, repeatedly, same as tests/trainer/model.ts's own dev-time cross
    // check when this table was built.
    let cur = SOLVED;
    for (let k = 1; k < c.order; k++) {
      cur = applyMoves(cur, c.alg);
      expect(cur, `after ${k} application(s)`).not.toBe(SOLVED);
    }
    cur = applyMoves(cur, c.alg);
    expect(cur).toBe(SOLVED);
  });
});

describe("pllTable — cross-case identity", () => {
  it("I2: all 21 canonical signatures are pairwise distinct", () => {
    const sigs = PLL_CASES.map((c) => canonicalSignature(applyMoves(SOLVED, invertAlg(c.alg))));
    expect(new Set(sigs).size).toBe(21);
  });

  it("I4: for each declared inverseOf pair, composing the two algorithms solves up to AUF", () => {
    const byId = new Map(PLL_CASES.map((c) => [c.id, c]));
    for (const c of PLL_CASES) {
      if (!c.inverseOf) continue;
      const partner = byId.get(c.inverseOf);
      expect(
        partner,
        `${c.id} declares inverseOf ${c.inverseOf}, which doesn't exist`,
      ).toBeDefined();
      const composed = applyMoves(applyMoves(SOLVED, c.alg), partner!.alg);
      const solvedUpToAuf = AUFS.some((auf) => composed === applyMoves(SOLVED, auf));
      expect(solvedUpToAuf, `${c.id} + ${c.inverseOf}`).toBe(true);
    }
  });

  it("inverseOf, when present, is symmetric", () => {
    const byId = new Map(PLL_CASES.map((c) => [c.id, c]));
    for (const c of PLL_CASES) {
      if (!c.inverseOf) continue;
      expect(byId.get(c.inverseOf)?.inverseOf).toBe(c.id);
    }
  });
});
