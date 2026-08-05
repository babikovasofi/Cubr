// squareGuidePx: the 3x3 face sampler assumes a square cube fills the guide
// region. This resolves any guide Rect (frame fractions) to a CENTERED pixel
// square (side = min dim), so the left/right sticker columns can't fall off the
// cube onto the background — the bug that read a solved cube ~70% wrong at verify
// while calibration (center cell only) always worked.

import { describe, it, expect } from "vitest";
import { squareGuidePx, type Rect } from "../../src/vision/config";

describe("squareGuidePx", () => {
  it("returns a pixel-square region regardless of the guide rect aspect", () => {
    // A deliberately wide 3.2:1 strip (the old broken GUIDE_RECT) on a 1280x720 frame.
    const wide: Rect = { x: 0.32, y: 0.4, w: 0.36, h: 0.2 };
    const g = squareGuidePx(wide, 1280, 720);
    expect(g.gw).toBe(g.gh); // SQUARE
    expect(g.gw).toBe(Math.round(0.2 * 720)); // side = min dim = the height (144)
  });

  it("centers the square inside a wide guide rect", () => {
    const wide: Rect = { x: 0.32, y: 0.4, w: 0.36, h: 0.2 };
    const g = squareGuidePx(wide, 1280, 720);
    const rw = 0.36 * 1280;
    const side = 0.2 * 720;
    // horizontally centered: gx = rectLeft + (rectW - side)/2
    expect(g.gx).toBe(Math.round(0.32 * 1280 + (rw - side) / 2));
  });

  it("is a near-no-op for an already-square-in-pixels guide rect", () => {
    // The new GUIDE_RECT: {0.35,0.24,0.3,0.55} on 1280x720 → 384 x 396 → square 384.
    const square: Rect = { x: 0.35, y: 0.24, w: 0.3, h: 0.55 };
    const g = squareGuidePx(square, 1280, 720);
    expect(g.gw).toBe(g.gh);
    expect(g.gw).toBe(Math.round(0.3 * 1280)); // limited by width (384), the smaller dim
  });

  it("handles a portrait / 4:3 frame by taking the smaller pixel dimension", () => {
    const square: Rect = { x: 0.35, y: 0.24, w: 0.3, h: 0.55 };
    const g = squareGuidePx(square, 960, 720); // 4:3
    expect(g.gw).toBe(g.gh);
    expect(g.gw).toBe(Math.round(0.3 * 960)); // 288, still the smaller of (288, 396)
  });
});
