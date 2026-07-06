import { describe, it, expect, beforeAll } from "vitest";
import Cube from "cubejs";
import {
  SOLVED,
  scrambleToFacelets,
  validateFacelets,
  diffFacelets,
  facesMatch,
  FACE_ORDER,
  randomStateFacelets,
} from "../cubeState.ts";
import { rotateGrid, normalizeByRotation } from "../cube.ts";

describe("URFDLB facelet mapping", () => {
  it("solved cube round-trips through cubejs", () => {
    const c = Cube.fromString(SOLVED);
    expect(c.asString()).toBe(SOLVED);
    expect(validateFacelets(SOLVED).ok).toBe(true);
  });

  it("SOLVED has centers U R F D L B at 4,13,22,31,40,49", () => {
    const centers = [4, 13, 22, 31, 40, 49];
    centers.forEach((idx, k) => expect(SOLVED[idx]).toBe(FACE_ORDER[k]));
  });

  // HIGH#2: known scramble -> hand-built facelet string -> cubejs solvable AND
  // equals expected. This proves our index mapping matches cubejs's URFDLB.
  it("a known scramble maps to a facelet string cubejs accepts and can solve", () => {
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'"; // T-perm-ish, well known
    const expected = scrambleToFacelets(scramble);

    // cubejs must accept and round-trip the expected string.
    const parsed = Cube.fromString(expected);
    expect(parsed.asString()).toBe(expected);
    expect(validateFacelets(expected).ok).toBe(true);

    // It must be solvable: applying the inverse returns to SOLVED.
    const c = Cube.fromString(SOLVED);
    c.move(scramble);
    expect(c.asString()).toBe(expected);
    c.move(invert(scramble));
    expect(c.asString()).toBe(SOLVED);
  });

  it("expected facelets differ from solved and diff pinpoints (face,index)", () => {
    const scramble = "U";
    const expected = scrambleToFacelets(scramble);
    expect(facesMatch(expected, SOLVED)).toBe(false);
    const diffs = diffFacelets(expected, SOLVED);
    expect(diffs.length).toBeGreaterThan(0);
    // A single U turn cycles the top ring of the four side faces (not U/D).
    for (const d of diffs) {
      expect(["R", "F", "L", "B"]).toContain(d.face);
    }
  });

  it("validation rejects an illegal string (wrong color count)", () => {
    const bad = "U".repeat(54); // 54 U's — impossible cube
    const v = validateFacelets(bad);
    expect(v.ok).toBe(false);
  });

  it("validation rejects a swapped-center string", () => {
    // Take solved, swap the R and F centers -> illegal.
    const arr = SOLVED.split("");
    [arr[13], arr[22]] = [arr[22], arr[13]];
    const v = validateFacelets(arr.join(""));
    expect(v.ok).toBe(false);
  });
});

describe("random state", () => {
  beforeAll(() => {
    Cube.initSolver();
  });

  it("randomStateFacelets yields a legal, solvable cube", () => {
    const { scramble, facelets } = randomStateFacelets();
    expect(validateFacelets(facelets).ok).toBe(true);
    // Applying the reported solve sequence returns to solved.
    const c = Cube.fromString(facelets);
    c.move(scramble);
    expect(c.asString()).toBe(SOLVED);
  });
});

describe("grid rotation normalization", () => {
  it("rotateGrid by 4 quarter-turns is identity", () => {
    const g = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(rotateGrid(g, 4)).toEqual(g);
    expect(rotateGrid(g, 0)).toEqual(g);
  });

  it("rotateGrid CW once puts index 6 (bottom-left) at top-left (index 0)", () => {
    const g = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    // CW: (r,c)->(c,2-r). bottom-left (2,0)=6 -> (0,0)=index0.
    const r = rotateGrid(g, 1);
    expect(r[0]).toBe(6);
    expect(r[4]).toBe(4); // center invariant
  });

  it("normalizeByRotation keeps center (cell 4) invariant under any k", () => {
    const g = ["a", "b", "c", "d", "X", "e", "f", "g", "h"];
    for (let k = 0; k < 4; k++) {
      expect(normalizeByRotation(g, k)[4]).toBe("X");
    }
  });
});

// Minimal move inverter for the round-trip check.
function invert(seq: string): string {
  return seq
    .trim()
    .split(/\s+/)
    .reverse()
    .map((m) => {
      if (m.endsWith("'")) return m.slice(0, -1);
      if (m.endsWith("2")) return m;
      return m + "'";
    })
    .join(" ");
}
