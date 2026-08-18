// Structural completeness of the OLL table's independent spec — validated
// against cornerTwist/edgeFlip ALONE, with zero reference to any `alg`
// field. Mirrors pllCompleteness.test.ts's role: a failure here means the
// spec itself is wrong (a duplicate class, a gap, or a bad twist/flip), and
// this must pass BEFORE a single algorithm string is typed into oll.ts — see
// oll.ts's header for the two-phase build order.
//
// The 216/58/57 figures below are not taken on faith: they fall out of the
// enumeration itself, computed here from the conservation laws (corner
// twists sum to 0 mod 3, edge flips sum to 0 mod 2) and grouped by the same
// 4-way canonical signature oll.ts's header and model.ts's OLL section
// explain (a single U turn shifts co/eo the way it shifts a permutation
// array; there is no meaningful second "pre-multiply" degree of freedom for
// pure orientation data, unlike PLL's permutation cycles).

import { describe, it, expect } from "vitest";
import {
  canonicalOllSignatureFromArrays,
  cornerTwistToArray,
  edgeFlipToArray,
  CORNER_POS,
  EDGE_POS,
} from "./model";
import { OLL_CASES } from "../../src/trainer/oll";

function allCo4(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++) {
        const d = (3 - ((a + b + c) % 3)) % 3;
        out.push([a, b, c, d]);
      }
  return out;
}

function allEo4(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) {
        const d = (2 - ((a + b + c) % 2)) % 2;
        out.push([a, b, c, d]);
      }
  return out;
}

describe("ollCompleteness — enumeration of all 216 legal last-layer orientation states", () => {
  const co4s = allCo4();
  const eo4s = allEo4();

  it("27 legal corner-orientation states, 8 legal edge-orientation states", () => {
    expect(co4s.length).toBe(27);
    expect(eo4s.length).toBe(8);
  });

  const classes = new Set<string>();
  let total = 0;
  let solvedKey = "";
  for (const co of co4s) {
    for (const eo of eo4s) {
      total++;
      const key = canonicalOllSignatureFromArrays(co, eo);
      classes.add(key);
      if (co.every((v) => v === 0) && eo.every((v) => v === 0)) solvedKey = key;
    }
  }

  it("216 legal (corner-orientation, edge-orientation) states", () => {
    expect(total).toBe(216);
  });

  it("group into exactly 58 canonical classes (1 solved + 57 OLL)", () => {
    expect(classes.size).toBe(58);
  });

  it("the table declares exactly 57 cases", () => {
    expect(OLL_CASES.length).toBe(57);
  });

  it("57 declared cornerTwist/edgeFlip land on 57 distinct non-solved classes — no gaps, no duplicates", () => {
    const declaredKeys = OLL_CASES.map((c) => {
      const co = cornerTwistToArray(c.cornerTwist, CORNER_POS);
      const eo = edgeFlipToArray(c.edgeFlip, EDGE_POS);
      return canonicalOllSignatureFromArrays(co, eo);
    });

    // No duplicates.
    expect(new Set(declaredKeys).size).toBe(57);

    // None is the solved class.
    expect(declaredKeys).not.toContain(solvedKey);

    // Exact bijection with the enumeration's 57 non-solved classes.
    const nonSolved = [...classes].filter((k) => k !== solvedKey).sort();
    expect(declaredKeys.slice().sort()).toEqual(nonSolved);
  });

  it("every case id and number is unique, and number matches id", () => {
    expect(new Set(OLL_CASES.map((c) => c.id)).size).toBe(57);
    expect(new Set(OLL_CASES.map((c) => c.number)).size).toBe(57);
    for (const c of OLL_CASES) {
      expect(c.id).toBe(`OLL${c.number}`);
    }
  });

  it("group counts: 7 corners-only + 3 edges-only + 47 mixed = 57", () => {
    const byGroup = { "corners-only": 0, "edges-only": 0, mixed: 0 };
    for (const c of OLL_CASES) byGroup[c.group]++;
    expect(byGroup).toEqual({ "corners-only": 7, "edges-only": 3, mixed: 47 });
  });
});
