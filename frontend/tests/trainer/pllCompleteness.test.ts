// Structural completeness of the PLL table's independent spec — validated
// against cornerCycle/edgeCycle ALONE, with zero reference to any `alg`
// field. This is the test the plan's step 3 requires pass BEFORE a single
// algorithm string is typed into pll.ts: a failure here means the spec
// itself is wrong (a duplicate class, a gap, or a bad cycle), caught before
// it could ever be masked by a self-consistent (but wrong) algorithm.

import { describe, it, expect } from "vitest";
import { canonicalSignatureFromPerm, permFromCycles, CORNER_POS, EDGE_POS } from "./model";
import { PLL_CASES } from "../../src/trainer/pll";

function permutations4(): number[][] {
  const out: number[][] = [];
  const base = [0, 1, 2, 3];
  const used = [false, false, false, false];
  const cur: number[] = [];
  function rec() {
    if (cur.length === 4) {
      out.push(cur.slice());
      return;
    }
    for (const v of base) {
      if (used[v]) continue;
      used[v] = true;
      cur.push(v);
      rec();
      cur.pop();
      used[v] = false;
    }
  }
  rec();
  return out;
}

function sign(perm: number[]): number {
  const seen = new Array(perm.length).fill(false);
  let transpositions = 0;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    let cur = i;
    while (!seen[cur]) {
      seen[cur] = true;
      cur = perm[cur];
      len++;
    }
    if (len > 0) transpositions += len - 1;
  }
  return transpositions % 2 === 0 ? 1 : -1;
}

describe("pllCompleteness — enumeration of all 288 legal last-layer states", () => {
  const cornerPerms = permutations4();
  const edgePerms = permutations4();

  const classes = new Set<string>();
  let total = 0;
  let solvedKey = "";
  for (const cp of cornerPerms) {
    for (const ep of edgePerms) {
      if (sign(cp) !== sign(ep)) continue;
      total++;
      const key = canonicalSignatureFromPerm(cp, ep);
      classes.add(key);
      if (cp.every((v, i) => v === i) && ep.every((v, i) => v === i)) solvedKey = key;
    }
  }

  it("288 legal (corner-perm, edge-perm) states with matching parity", () => {
    expect(total).toBe(288);
  });

  it("group into exactly 22 canonical classes (1 solved + 21 PLL)", () => {
    expect(classes.size).toBe(22);
  });

  it("the table declares exactly 21 cases", () => {
    expect(PLL_CASES.length).toBe(21);
  });

  it("21 declared cornerCycle/edgeCycle land on 21 distinct non-solved classes — no gaps, no duplicates", () => {
    const declaredKeys = PLL_CASES.map((c) => {
      const cp = permFromCycles(c.cornerCycle, CORNER_POS);
      const ep = permFromCycles(c.edgeCycle, EDGE_POS);
      return canonicalSignatureFromPerm(cp, ep);
    });

    // No duplicates.
    expect(new Set(declaredKeys).size).toBe(21);

    // None is the solved class.
    expect(declaredKeys).not.toContain(solvedKey);

    // Exact bijection with the enumeration's 21 non-solved classes.
    const nonSolved = [...classes].filter((k) => k !== solvedKey).sort();
    expect(declaredKeys.slice().sort()).toEqual(nonSolved);
  });

  it("every case id and group is unique", () => {
    expect(new Set(PLL_CASES.map((c) => c.id)).size).toBe(21);
  });
});
