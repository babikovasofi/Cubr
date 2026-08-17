// Pins pll.ts's stored `facelets` field to the model, character-for-character.
// This is the only thing keeping the runtime cubejs-free without silent
// drift: LastLayerDiagram.tsx reads `facelets` directly, never re-deriving it
// from `alg` (which would need cubejs at runtime).

import { describe, it, expect } from "vitest";
import { applyMoves, invertAlg, SOLVED } from "./model";
import { PLL_CASES } from "../../src/trainer/pll";

describe.each(PLL_CASES)("facelets [$id]", (c) => {
  it("matches applyMoves(SOLVED, invertAlg(alg)) exactly", () => {
    expect(c.facelets).toBe(applyMoves(SOLVED, invertAlg(c.alg)));
  });

  it("is 54 characters", () => {
    expect(c.facelets).toHaveLength(54);
  });
});
