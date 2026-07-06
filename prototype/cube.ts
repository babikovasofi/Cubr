// Cube-face reading: crop the guide-frame region from the video into a work
// canvas, split into a 3x3 grid, sample the central region of each of the 9
// cells, and rotation-normalize the face by its center sticker.
//
// ROTATION NORMALIZATION (plan #6): the tester only has to roughly match the
// capture prompt. After reading the 9 cells we can rotate the grid 0/90/180/270
// so the result is in a canonical orientation. Rotation is chosen so the read
// is consistent; the CENTER (cell 4) always names the face color regardless.

import { medianOfCentralRegion, rgb2lab, type Lab, type RGB } from "./colors.ts";
import { config, type Rect } from "./config.ts";

export interface FaceSample {
  rgb: RGB[]; // 9 median RGBs, grid order 0..8 (row-major, TL..BR)
  lab: Lab[]; // same, in Lab
}

/**
 * Read the guide-frame region of `source` as a 3x3 face.
 * `source` is the RAW (un-mirrored) video; `w`,`h` its intrinsic size.
 */
export function readFace(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
  centerFrac: number = config.CELL_CENTER_FRAC,
): FaceSample {
  const gx = Math.round(guide.x * w);
  const gy = Math.round(guide.y * h);
  const gw = Math.round(guide.w * w);
  const gh = Math.round(guide.h * h);

  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);

  const cellW = Math.floor(gw / 3);
  const cellH = Math.floor(gh / 3);

  const rgb: RGB[] = [];
  const lab: Lab[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = col * cellW;
      const cy = row * cellH;
      const data = ctx.getImageData(cx, cy, cellW, cellH).data;
      const med = medianOfCentralRegion(data, cellW, cellH, centerFrac);
      rgb.push(med);
      lab.push(rgb2lab(med));
    }
  }
  return { rgb, lab };
}

// ---- Grid rotation helpers -------------------------------------------------

// Rotate a 9-element row-major 3x3 grid clockwise by 90 degrees.
export function rotateCW(grid: number[]): number[] {
  // src index -> dst: (r,c) -> (c, 2-r)
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[c * 3 + (2 - r)] = grid[r * 3 + c];
    }
  }
  return out;
}

/** Rotate any 9-element grid by k*90 degrees clockwise (k = 0..3). */
export function rotateGrid<T>(grid: T[], k: number): T[] {
  let g = grid.slice();
  const n = ((k % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    const out = new Array(9) as T[];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) out[c * 3 + (2 - r)] = g[r * 3 + c];
    }
    g = out;
  }
  return g;
}

/**
 * Normalize a captured face's rotation. The overlay marks the U-edge (top) but
 * the tester may be off by a quarter turn. Given the expected top-edge marker
 * position, this returns the grid rotated so index 0 is the true top-left.
 *
 * In Stage-0 the capture protocol fixes orientation and the CENTER sticker
 * (cell 4) authoritatively names the color, so `k` defaults to 0. Kept explicit
 * and tested so Stage-1 can wire real orientation detection here.
 */
export function normalizeByRotation<T>(grid: T[], k = 0): T[] {
  return rotateGrid(grid, k);
}

// ---- Frame quality (sanity gate input) ------------------------------------

/** Mean luma (Rec. 601) of the guide region, 0..255. */
export function guideRegionLuma(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
): number {
  const gx = Math.round(guide.x * w);
  const gy = Math.round(guide.y * h);
  const gw = Math.round(guide.w * w);
  const gh = Math.round(guide.h * h);
  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  let sum = 0;
  const count = gw * gh;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / count;
}
