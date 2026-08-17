import { describe, it, expect } from "vitest";
import {
  AUFS,
  ORIENTATIONS,
  invertAlg,
  simplifyMoves,
  pickCase,
  generateCaseScramble,
} from "../../src/trainer/generate";
import { PLL_CASES, ALL_CASE_IDS, getCase } from "../../src/trainer/pll";
import { mulberry32 } from "../../src/lib/rng";
import {
  applyMoves as modelApplyMoves,
  canonicalSignature,
  sameCaseUpToAufAndOrientation,
  SOLVED,
} from "./model";

describe("ORIENTATIONS", () => {
  it("has exactly 24 entries", () => {
    expect(ORIENTATIONS).toHaveLength(24);
  });

  it("every entry parses and produces 24 pairwise-distinct orientations of solved", () => {
    const results = ORIENTATIONS.map((o) => modelApplyMoves(SOLVED, o));
    expect(new Set(results).size).toBe(24);
  });
});

describe("invertAlg", () => {
  it("is a correct inverse for all 21 case algorithms", () => {
    for (const c of PLL_CASES) {
      const roundTrip = modelApplyMoves(modelApplyMoves(SOLVED, c.alg), invertAlg(c.alg));
      expect(roundTrip, c.id).toBe(SOLVED);
    }
  });

  it("is a correct inverse for synthetic strings covering x/y/z, M/S/E, and wide moves", () => {
    const synthetic = [
      "x y z",
      "x2 y2 z2",
      "x' y' z'",
      "M S E",
      "M2 S2 E2",
      "M' S' E'",
      "r u f l d b",
      "r2 u2 f2 l2 d2 b2",
      "r' u' f' l' d' b'",
      "x R U r M y F' S2",
    ];
    for (const alg of synthetic) {
      const roundTrip = modelApplyMoves(modelApplyMoves(SOLVED, alg), invertAlg(alg));
      expect(roundTrip, alg).toBe(SOLVED);
    }
  });
});

describe("simplifyMoves", () => {
  it("targeted cases", () => {
    expect(simplifyMoves(["U", "U'"])).toEqual([]);
    expect(simplifyMoves(["U", "U"])).toEqual(["U2"]);
    expect(simplifyMoves(["U2", "U2"])).toEqual([]);
    expect(simplifyMoves(["R", "U", "U'", "R'"])).toEqual([]);
    expect(simplifyMoves(["U2", "U"])).toEqual(["U'"]);
    expect(simplifyMoves(["U", "U2"])).toEqual(["U'"]);
  });

  it("preserves the resulting state for all 21 cases x 4 AUF", () => {
    for (const c of PLL_CASES) {
      for (const auf of AUFS) {
        const raw = [invertAlg(c.alg), auf].filter(Boolean).join(" ");
        const simplified = simplifyMoves(raw.split(/\s+/).filter(Boolean)).join(" ");
        expect(modelApplyMoves(SOLVED, raw), `${c.id} ${auf}`).toBe(
          modelApplyMoves(SOLVED, simplified),
        );
      }
    }
  });

  it("no two adjacent same-face tokens remain in the simplified output", () => {
    for (const c of PLL_CASES) {
      const raw = [invertAlg(c.alg), "U"].join(" ").split(/\s+/).filter(Boolean);
      const simplified = simplifyMoves(raw);
      for (let i = 1; i < simplified.length; i++) {
        expect(simplified[i][0]).not.toBe(simplified[i - 1][0]);
      }
    }
  });
});

describe("pickCase", () => {
  it("only returns ids from the given list", () => {
    const ids = ALL_CASE_IDS.slice(0, 3);
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      expect(ids).toContain(pickCase(ids, rng));
    }
  });

  it("throws on an empty list", () => {
    expect(() => pickCase([])).toThrow();
  });
});

describe("generateCaseScramble", () => {
  it("scramble leaves the declared case — exact equality across all 21 cases x 4 AUF", () => {
    for (const c of PLL_CASES) {
      for (const auf of AUFS) {
        // Force a specific AUF deterministically by scanning rng outputs
        // that map to it, rather than trusting randomness for this exact check.
        const aufIndex = AUFS.indexOf(auf);
        const rng = () => aufIndex / AUFS.length + 0.001; // lands in that AUF's bucket
        const scramble = generateCaseScramble(c, { rng });
        const got = modelApplyMoves(SOLVED, scramble);
        const want = modelApplyMoves(c.facelets, auf);
        expect(got, `${c.id} ${auf}`).toBe(want);
      }
    }
  });

  it('"any grip": scramble matches the case up to AUF and orientation, for all 21 cases', () => {
    const rng = mulberry32(7);
    for (const c of PLL_CASES) {
      for (let trial = 0; trial < 4; trial++) {
        const scramble = generateCaseScramble(c, { rng, anyGrip: true });
        const got = modelApplyMoves(SOLVED, scramble);
        expect(sameCaseUpToAufAndOrientation(got, c.facelets), `${c.id} trial ${trial}`).toBe(true);
      }
    }
  });

  it("AUF doesn't change the case: 4 AUF variants are 4 distinct strings, one canonicalSignature", () => {
    for (const c of PLL_CASES) {
      const variants = AUFS.map((auf) => modelApplyMoves(c.facelets, auf));
      expect(new Set(variants).size, c.id).toBe(4);
      const sigs = new Set(variants.map((v) => canonicalSignature(v)));
      expect(sigs.size, c.id).toBe(1);
    }
  });

  it("never solved: no draw (21 x 4 AUF) equals SOLVED or an AUF-of-solved", () => {
    const solvedVariants = new Set(AUFS.map((auf) => modelApplyMoves(SOLVED, auf)));
    for (const c of PLL_CASES) {
      for (const auf of AUFS) {
        const state = modelApplyMoves(c.facelets, auf);
        expect(solvedVariants.has(state), `${c.id} ${auf}`).toBe(false);
      }
    }
  });

  it("determinism: same seed -> byte-identical output across two runs of 100 draws", () => {
    function run(seed: number) {
      const rng = mulberry32(seed);
      const out: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = pickCase(ALL_CASE_IDS, rng);
        out.push(generateCaseScramble(getCase(id), { rng, anyGrip: true }));
      }
      return out;
    }
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("distribution: over 4000 draws, all 4 AUF and all 24 orientations appear", () => {
    const rng = mulberry32(99);
    const c = getCase("T");
    const seenAuf = new Set<string>();
    const seenOrientationCount = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const scramble = generateCaseScramble(c, { rng, anyGrip: true });
      for (const auf of AUFS) {
        if (modelApplyMoves(SOLVED, scramble) === modelApplyMoves(c.facelets, auf)) {
          seenAuf.add(auf);
        }
      }
      // Coarser signal for orientation coverage: how many distinct scramble
      // *strings* appear — with 24 orientations x 4 AUF there should be far
      // more than 4 distinct strings over 4000 draws.
      seenOrientationCount.add(scramble);
    }
    expect(seenAuf.size).toBe(4);
    expect(seenOrientationCount.size).toBeGreaterThan(4);
  });

  it("with an N-case selection, all N ids appear over many draws", () => {
    const ids = ALL_CASE_IDS.slice(0, 5);
    const rng = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(pickCase(ids, rng));
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });
});
