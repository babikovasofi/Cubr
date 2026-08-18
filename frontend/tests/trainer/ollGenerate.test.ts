// generate.ts is shared, unforked, between PLL and OLL (see its header) —
// this file proves the SAME `generateCaseScramble`/`pickCase` functions
// generate.test.ts already covers for PLL are equally correct for OLL,
// using the OLL-specific "same case" oracle (`sameOllCaseUpToAuf*` — an
// orientation signature, not a permutation one; see model.ts's OLL section).

import { describe, it, expect } from "vitest";
import { AUFS, invertAlg, pickCase, generateCaseScramble } from "../../src/trainer/generate";
import { OLL_CASES, ALL_OLL_CASE_IDS, getOllCase } from "../../src/trainer/oll";
import { mulberry32 } from "../../src/lib/rng";
import {
  applyMoves as modelApplyMoves,
  canonicalOllSignature,
  sameOllCaseUpToAufAndOrientation,
  SOLVED,
} from "./model";

describe("invertAlg — correct inverse for all 57 OLL algorithms", () => {
  it("applyMoves(applyMoves(SOLVED, alg), invertAlg(alg)) === SOLVED", () => {
    for (const c of OLL_CASES) {
      const roundTrip = modelApplyMoves(modelApplyMoves(SOLVED, c.alg), invertAlg(c.alg));
      expect(roundTrip, c.id).toBe(SOLVED);
    }
  });
});

describe("generateCaseScramble — OLL", () => {
  it("scramble leaves the declared case — exact equality across all 57 cases x 4 AUF", () => {
    for (const c of OLL_CASES) {
      for (const auf of AUFS) {
        const aufIndex = AUFS.indexOf(auf);
        const rng = () => aufIndex / AUFS.length + 0.001;
        const scramble = generateCaseScramble(c, { rng });
        const got = modelApplyMoves(SOLVED, scramble);
        const want = modelApplyMoves(c.facelets, auf);
        expect(got, `${c.id} ${auf}`).toBe(want);
      }
    }
  });

  it('"any grip": scramble matches the case up to AUF and orientation, for all 57 cases', () => {
    const rng = mulberry32(11);
    for (const c of OLL_CASES) {
      for (let trial = 0; trial < 3; trial++) {
        const scramble = generateCaseScramble(c, { rng, anyGrip: true });
        const got = modelApplyMoves(SOLVED, scramble);
        expect(sameOllCaseUpToAufAndOrientation(got, c.facelets), `${c.id} trial ${trial}`).toBe(
          true,
        );
      }
    }
  });

  it("AUF doesn't change the case: 4 AUF variants are 4 distinct strings, one canonicalOllSignature", () => {
    for (const c of OLL_CASES) {
      const variants = AUFS.map((auf) => modelApplyMoves(c.facelets, auf));
      expect(new Set(variants).size, c.id).toBe(4);
      const sigs = new Set(variants.map((v) => canonicalOllSignature(v)));
      expect(sigs.size, c.id).toBe(1);
    }
  });

  it("never solved: no draw (57 x 4 AUF) equals SOLVED or an AUF-of-solved", () => {
    const solvedVariants = new Set(AUFS.map((auf) => modelApplyMoves(SOLVED, auf)));
    for (const c of OLL_CASES) {
      for (const auf of AUFS) {
        const state = modelApplyMoves(c.facelets, auf);
        expect(solvedVariants.has(state), `${c.id} ${auf}`).toBe(false);
      }
    }
  });

  it("PLL and OLL are never confused: every OLL draw has a non-uniform U face", () => {
    for (const c of OLL_CASES) {
      const scramble = generateCaseScramble(c, { rng: mulberry32(3) });
      const state = modelApplyMoves(SOLVED, scramble);
      expect(state.slice(0, 9), c.id).not.toBe("UUUUUUUUU");
    }
  });

  it("determinism: same seed -> byte-identical output across two runs of 100 draws", () => {
    function run(seed: number) {
      const rng = mulberry32(seed);
      const out: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = pickCase(ALL_OLL_CASE_IDS, rng);
        out.push(generateCaseScramble(getOllCase(id), { rng, anyGrip: true }));
      }
      return out;
    }
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("distribution: over 4000 draws, all 4 AUF appear for a fixed case", () => {
    const rng = mulberry32(99);
    const c = getOllCase("OLL27"); // Sune
    const seenAuf = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const scramble = generateCaseScramble(c, { rng, anyGrip: true });
      for (const auf of AUFS) {
        if (modelApplyMoves(SOLVED, scramble) === modelApplyMoves(c.facelets, auf)) {
          seenAuf.add(auf);
        }
      }
    }
    expect(seenAuf.size).toBe(4);
  });

  it("with an N-case selection, all N ids appear over many draws", () => {
    const ids = ALL_OLL_CASE_IDS.slice(0, 6);
    const rng = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      seen.add(pickCase(ids, rng));
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("mixed PLL+OLL id pool: pickCase draws from both without collision", () => {
    // PLL ids (2-letter, e.g. "Ua") and OLL ids ("OLL1".."OLL57") are disjoint
    // string unions -- this is the "no fork needed in the shared pool" claim
    // useTrainer.ts relies on, checked directly.
    const pllIds = ["Ua", "Ub", "H"] as const;
    const mixed: readonly string[] = [...pllIds, ...ALL_OLL_CASE_IDS.slice(0, 3)];
    expect(new Set(mixed).size).toBe(mixed.length); // no accidental collisions
    const rng = mulberry32(2);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickCase(mixed, rng));
    expect([...seen].sort()).toEqual([...mixed].sort());
  });
});
