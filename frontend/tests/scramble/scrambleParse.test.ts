import { describe, it, expect } from "vitest";
import { parseMoves } from "../../src/scramble/hooks/useScramble";
import { scrambleToFacelets, validateFacelets, SOLVED } from "../../src/vision/cubeState";

describe("parseMoves", () => {
  it("splits a scramble into tokens and drops empties", () => {
    expect(parseMoves("R U' F2 D L2")).toEqual(["R", "U'", "F2", "D", "L2"]);
    expect(parseMoves("  R   U   ")).toEqual(["R", "U"]);
    expect(parseMoves("")).toEqual([]);
  });

  it("token count matches the walkthrough step count", () => {
    const alg = "R U R' U' F2 B'";
    expect(parseMoves(alg).length).toBe(6);
  });
});

describe("cubing string → cubeState bridge", () => {
  it("scrambleToFacelets yields a legal, validated 54-char state", () => {
    // A cubing-style scramble string fed straight into the verification bridge.
    const alg = "R U R' U' F2 D2 L B2 R2 U'";
    const facelets = scrambleToFacelets(alg);
    expect(facelets).toHaveLength(54);
    const v = validateFacelets(facelets);
    expect(v.ok).toBe(true);
  });

  it("an empty scramble maps to the solved reference", () => {
    expect(scrambleToFacelets("")).toBe(SOLVED);
    expect(validateFacelets(SOLVED).ok).toBe(true);
  });
});
