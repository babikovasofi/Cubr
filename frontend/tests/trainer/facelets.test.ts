// Pins pll.ts's and oll.ts's stored `facelets` fields to the model,
// character-for-character. This is the only thing keeping the runtime
// cubejs-free without silent drift: LastLayerDiagram.tsx/OllDiagram.tsx read
// `facelets` directly, never re-deriving it from `alg` (which would need
// cubejs at runtime).

import { describe, it, expect } from "vitest";
import { applyMoves, invertAlg, SOLVED } from "./model";
import { PLL_CASES } from "../../src/trainer/pll";
import { OLL_CASES } from "../../src/trainer/oll";

describe.each(PLL_CASES)("facelets [$id]", (c) => {
  it("matches applyMoves(SOLVED, invertAlg(alg)) exactly", () => {
    expect(c.facelets).toBe(applyMoves(SOLVED, invertAlg(c.alg)));
  });

  it("is 54 characters", () => {
    expect(c.facelets).toHaveLength(54);
  });
});

describe.each(OLL_CASES)("facelets [$id $name]", (c) => {
  it("matches applyMoves(SOLVED, invertAlg(alg)) exactly", () => {
    expect(c.facelets).toBe(applyMoves(SOLVED, invertAlg(c.alg)));
  });

  it("is 54 characters", () => {
    expect(c.facelets).toHaveLength(54);
  });
});
