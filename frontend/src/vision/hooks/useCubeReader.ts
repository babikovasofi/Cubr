// Canvas-bound cube-face readers (extracted from the prototype's cube.ts). These
// touch getContext/getImageData, so they live in a hook module, not the pure
// cubeGrid. STUB hook: Stage 1.1 only exposes the readers + a skeleton; the full
// solve-screen wiring is Stage 1.2.

import { medianOfCentralRegion, rgb2lab, type Lab, type RGB } from "../colors";
import { config, type Rect } from "../config";

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

  // Distribute the pixel remainder so all gw x gh pixels are covered.
  const xEdges = [0, Math.round(gw / 3), Math.round((2 * gw) / 3), gw];
  const yEdges = [0, Math.round(gh / 3), Math.round((2 * gh) / 3), gh];

  const rgb: RGB[] = [];
  const lab: Lab[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = xEdges[col];
      const cy = yEdges[row];
      const cellW = xEdges[col + 1] - cx;
      const cellH = yEdges[row + 1] - cy;
      const data = ctx.getImageData(cx, cy, cellW, cellH).data;
      const med = medianOfCentralRegion(data, cellW, cellH, centerFrac);
      rgb.push(med);
      lab.push(rgb2lab(med));
    }
  }
  return { rgb, lab };
}

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

/**
 * STUB hook (Stage 1.2 wires it). Returns the readers bound to a work-canvas ref.
 * No effects yet — just the shape the solve screen will consume.
 */
export function useCubeReader() {
  return { readFace, guideRegionLuma };
}
