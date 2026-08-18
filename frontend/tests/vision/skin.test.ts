// Палец на грани против оранжевой наклейки.
//
// Живой прогон 2026-08-19 (stickerless, LED): половина промахов чтения — ячейки
// с телесным тоном, и ВСЕ ошибки red↔orange пошли в одну сторону (R→L 3,
// L→R 0). Расстоянием до эталонов эти два случая не разделить: кожа лежит
// близко к оранжевому, argmin выбирает его уверенно. Разделяет хрома в YCbCr.

import { describe, it, expect } from "vitest";
import { skinFraction } from "../../src/vision/colors";
import { config } from "../../src/vision/config";

type RGB = [number, number, number];

/** Ячейка, залитая одним цветом; при `mix` — часть площади вторым. */
function cell(size: number, c: RGB, mix?: { color: RGB; frac: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const cut = mix ? Math.round(size * mix.frac) : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c2 = mix && x < cut ? mix.color : c;
      const i = (y * size + x) * 4;
      data[i] = c2[0];
      data[i + 1] = c2[1];
      data[i + 2] = c2[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

// Эталоны калибровки живой сессии 2026-08-19.
const CUBE: Record<string, RGB> = {
  U: [200, 211, 218],
  R: [234, 72, 71],
  F: [0, 170, 91],
  D: [207, 206, 67],
  L: [252, 118, 58],
  B: [52, 122, 218],
};

// Ячейки, которые в том же прогоне прочитались как оранжевые, а были пальцем.
const SKIN_LIVE: RGB[] = [
  [233, 169, 141],
  [186, 129, 107],
  [226, 152, 131],
  [190, 155, 117],
  [219, 147, 115],
  [190, 147, 107],
  [128, 101, 68],
];

describe("skinFraction", () => {
  it("ни один цвет кубика не читается как кожа", () => {
    for (const [name, rgb] of Object.entries(CUBE)) {
      expect(skinFraction(cell(24, rgb), 24, 24), name).toBeLessThan(0.01);
    }
  });

  it("живые ячейки с пальцем читаются как кожа целиком", () => {
    for (const rgb of SKIN_LIVE) {
      expect(skinFraction(cell(24, rgb), 24, 24), String(rgb)).toBeGreaterThan(0.99);
    }
  });

  // Оранжевый — ближайший к коже цвет кубика, и по одному Cb он бы прошёл
  // (76.8 при нижней границе 77). Спасает пара условий: Cr 197 при потолке 173.
  it("оранжевая наклейка не проходит именно по Cr, а не случайно", () => {
    const [r, g, b] = CUBE.L;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 + 0.564 * (b - y);
    const cr = 128 + 0.713 * (r - y);
    expect(cb).toBeLessThan(config.SKIN_CB_MIN + 1); // по Cb — на самой границе
    expect(cr).toBeGreaterThan(config.SKIN_CR_MAX); // по Cr — с большим запасом
  });

  it("палец на половине ячейки виден как половина", () => {
    const f = skinFraction(cell(24, CUBE.D, { color: SKIN_LIVE[0], frac: 0.5 }), 24, 24);
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(0.6);
  });

  // Край ячейки законно захватывает соседнюю наклейку и кромку пальца в ней;
  // считаем по тем же центральным процентам, что и цвет.
  it("смотрит только в центральную часть ячейки", () => {
    const edgeFinger = cell(24, CUBE.U, { color: SKIN_LIVE[0], frac: 0.2 });
    expect(skinFraction(edgeFinger, 24, 24, 0.5)).toBe(0);
  });

  it("пустая ячейка не делит на ноль", () => {
    expect(skinFraction(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });
});
