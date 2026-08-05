// Casual-solo tolerant verify scoring (cubeGrid.lenientVerify). Unlike the strict
// resolveRotations (demands a globally-legal cube), this scores the real read
// against expected facelets face-by-face, best-rotation, and returns a mismatch
// count the caller gates on a tolerance. Rotation-invariant; a wrong cube fails.

import { describe, it, expect } from "vitest";
import { lenientVerify, rotateGrid } from "../../src/vision/cubeGrid";
import { SOLVED, scrambleToFacelets, FACE_ORDER, type Face } from "../../src/vision/cubeState";

/** Split a 54-char URFDLB facelet string into six 9-letter face grids. */
function toFaceGrids(fl: string): Face[][] {
  const grids: Face[][] = [];
  for (let i = 0; i < 6; i++) grids.push(fl.slice(i * 9, (i + 1) * 9).split("") as Face[]);
  return grids;
}

describe("lenientVerify (casual-solo tolerant match)", () => {
  it("perfect read of the expected cube → 0 mismatches", () => {
    const expected = scrambleToFacelets("R U R' U' F2 D2 L B2");
    const grids = toFaceGrids(expected);
    const r = lenientVerify(grids, [...FACE_ORDER], expected);
    expect(r.mismatches).toBe(0);
    expect(r.totalStickers).toBe(54);
  });

  it("solved read against SOLVED → 0 mismatches", () => {
    const r = lenientVerify(toFaceGrids(SOLVED), [...FACE_ORDER], SOLVED);
    expect(r.mismatches).toBe(0);
  });

  it("is rotation-invariant: a face rotated by a quarter turn still scores 0", () => {
    const expected = scrambleToFacelets("R U R' U' F2 D2 L B2");
    const grids = toFaceGrids(expected);
    grids[0] = rotateGrid(grids[0], 1); // spin the U capture 90° — best-rotation must undo it
    const r = lenientVerify(grids, [...FACE_ORDER], expected);
    expect(r.mismatches).toBe(0);
  });

  it("counts a few misread stickers, attributing them to the worst face", () => {
    const expected = scrambleToFacelets("R U R' U' F2 D2 L B2");
    const grids = toFaceGrids(expected);
    // Corrupt 2 stickers on the R face (slot 1) with a different colour letter.
    const wrong: Face = grids[1][0] === "U" ? "D" : "U";
    grids[1][0] = wrong;
    grids[1][2] = wrong;
    const r = lenientVerify(grids, [...FACE_ORDER], expected);
    expect(r.mismatches).toBe(2);
    expect(r.worstFace).toBe("R");
    expect(r.worstCount).toBe(2);
  });

  it("a solved cube shown against a scramble expected → many mismatches (won't pass tolerance)", () => {
    const expected = scrambleToFacelets("R U R' U' F2 D2 L B2 R2 U' F D2 B'");
    const solvedGrids = toFaceGrids(SOLVED); // physically solid faces, wrong for a scramble
    const r = lenientVerify(solvedGrids, [...FACE_ORDER], expected);
    const correctFrac = (r.totalStickers - r.mismatches) / r.totalStickers;
    expect(correctFrac).toBeLessThan(0.7); // below CASUAL_VERIFY_MIN_CORRECT_FRAC
  });
});
