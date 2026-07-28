// Подгонка сетки под реальное положение грани. Проверяем на синтетическом кадре:
// кубик нарисован не по центру и меньше рамки — ровно та ситуация, в которой
// раньше ячейки съезжали на фон и белая наклейка читалась как красная.

import { describe, it, expect } from "vitest";
import { fitFaceRegion, regionCost, candidateRegions, type Patch } from "../../src/vision/faceFit";
import { rgb2lab, type Refs, type RGB } from "../../src/vision/colors";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;

const WALL: RGB = [150, 130, 160]; // сиреневая стена, как на живом кадре

/**
 * Патч со «сценой»: фон-стена, на ней грань кубика (9 наклеек с тёмными щелями)
 * в заданном месте и заданного размера.
 */
function scene(size: number, faceX: number, faceY: number, faceSide: number, colors: RGB[]): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number, c: RGB) => {
    const i = (y * size + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, WALL);

  const cell = faceSide / 3;
  const gap = Math.max(1, Math.round(cell * 0.08)); // щель между наклейками
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const c = colors[row * 3 + col];
      const x0 = Math.round(faceX + col * cell) + gap;
      const y0 = Math.round(faceY + row * cell) + gap;
      const x1 = Math.round(faceX + (col + 1) * cell) - gap;
      const y1 = Math.round(faceY + (row + 1) * cell) - gap;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x >= 0 && y >= 0 && x < size && y < size) put(x, y, c);
        }
      }
    }
  }
  return { data, size };
}

const WHITE_FACE: RGB[] = Array.from({ length: 9 }, () => REF_RGB.U);
const MIXED_FACE: RGB[] = [
  REF_RGB.U,
  REF_RGB.R,
  REF_RGB.F,
  REF_RGB.D,
  REF_RGB.U,
  REF_RGB.L,
  REF_RGB.B,
  REF_RGB.F,
  REF_RGB.U,
];

describe("candidateRegions", () => {
  it("перебирает и масштаб, и сдвиг, оставаясь внутри патча", () => {
    const cands = candidateRegions(120);
    expect(cands.length).toBeGreaterThan(20);
    for (const c of cands) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.side).toBeLessThanOrEqual(120.001);
      expect(c.y + c.side).toBeLessThanOrEqual(120.001);
    }
  });
});

describe("fitFaceRegion", () => {
  it("находит грань, которая меньше рамки и смещена в угол", () => {
    const size = 120;
    const patch = scene(size, 8, 10, 72, MIXED_FACE);
    const fit = fitFaceRegion(patch, REFS);

    expect(fit.cost).toBeLessThan(fit.baselineCost);
    // Найденный квадрат перекрывает настоящий: центр не дальше четверти стороны.
    const cx = fit.region.x + fit.region.side / 2;
    const cy = fit.region.y + fit.region.side / 2;
    expect(Math.abs(cx - (8 + 36))).toBeLessThan(18);
    expect(Math.abs(cy - (10 + 36))).toBeLessThan(18);
  });

  it("грань во весь патч оставляет как есть — дёргать нечего", () => {
    const patch = scene(120, 0, 0, 120, WHITE_FACE);
    const fit = fitFaceRegion(patch, REFS);
    expect(fit.cost).toBeLessThanOrEqual(fit.baselineCost);
    expect(fit.region.side).toBeGreaterThan(120 * 0.85);
  });

  it("сетка на фоне стоит дороже сетки на кубике", () => {
    const size = 120;
    const patch = scene(size, 8, 10, 72, MIXED_FACE);
    const onCube = regionCost(patch, { x: 8, y: 10, side: 72 }, REFS);
    const onWall = regionCost(patch, { x: 0, y: 0, side: 40 }, REFS);
    expect(onCube).toBeLessThan(onWall);
  });
});
