// Устойчивое чтение ячейки и пер-грань нормировка света. Оба механизма
// появились из живого багрепорта: белая наклейка читалась как красная.

import { describe, it, expect } from "vitest";
import {
  robustCellColor,
  normalizeFaceByCenter,
  rgb2lab,
  deltaE,
  applyLightGain,
  type RGB,
} from "../../src/vision/colors";

/** Ячейка из одного цвета, в которую вписано пятно другого. */
function cell(
  w: number,
  h: number,
  base: RGB,
  blob?: { color: RGB; frac: number },
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  const blobPixels = blob ? Math.round(w * h * blob.frac) : 0;
  let painted = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const useBlob = blob && painted < blobPixels;
      const c = useBlob ? blob!.color : base;
      if (useBlob) painted++;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

const RED: RGB = [190, 40, 45];
const GLARE: RGB = [255, 252, 250];

describe("robustCellColor", () => {
  it("чистая ячейка читается как есть", () => {
    const out = robustCellColor(cell(20, 20, RED), 20, 20);
    expect(out.rgb[0]).toBeGreaterThan(150);
    expect(out.kept).toBeGreaterThan(0.9);
  });

  it("блик на трети ячейки не уводит цвет", () => {
    const withGlare = robustCellColor(cell(20, 20, RED, { color: GLARE, frac: 0.35 }), 20, 20);
    const clean = robustCellColor(cell(20, 20, RED), 20, 20);
    expect(deltaE(rgb2lab(withGlare.rgb), rgb2lab(clean.rgb))).toBeLessThan(6);
  });

  it("сплошной пересвет честно сообщает низкую надёжность", () => {
    const out = robustCellColor(cell(20, 20, GLARE), 20, 20);
    expect(out.kept).toBeLessThan(0.5);
  });
});

describe("normalizeFaceByCenter", () => {
  it("возвращает грань к эталонному свету", () => {
    const trueColors: RGB[] = Array.from({ length: 9 }, () => [235, 238, 236]);
    const centerRef = rgb2lab(trueColors[4]);
    // Тёплая лампа: канальный сдвиг всей грани.
    const warm: [number, number, number] = [1.18, 1.0, 0.78];
    const observed = trueColors.map((c) => applyLightGain(c, warm));

    const fixed = normalizeFaceByCenter(observed, centerRef);

    const before = deltaE(rgb2lab(observed[0]), centerRef);
    const after = deltaE(rgb2lab(fixed[0]), centerRef);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(3);
  });

  it("не трогает грань, снятую при эталонном свете", () => {
    const colors: RGB[] = Array.from({ length: 9 }, () => [200, 60, 60]);
    const fixed = normalizeFaceByCenter(colors, rgb2lab(colors[4]));
    expect(deltaE(rgb2lab(fixed[0]), rgb2lab(colors[0]))).toBeLessThan(1);
  });
});
