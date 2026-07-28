// Порог уверенности классификации. Смысл: «ближайший эталон победил» — это ещё
// не чтение. Если второй кандидат почти так же близко или ячейку съел блик,
// грань надо переспросить, а не тащить сомнительный цвет в сборку кубика.

import { describe, it, expect } from "vitest";
import { confidentCells, stickerConfidence } from "../../src/vision/hooks/useCubeReader";
import { rgb2lab, type Refs, type RGB } from "../../src/vision/colors";
import { config } from "../../src/vision/config";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};

const REFS: Refs = Object.fromEntries(
  Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)]),
) as Refs;

const ALL_KEPT = Array.from({ length: 9 }, () => 1);

describe("stickerConfidence", () => {
  it("точный цвет даёт большой отрыв от второго кандидата", () => {
    const out = stickerConfidence(rgb2lab(REF_RGB.F), REFS);
    expect(out.best).toBe("F");
    expect(out.margin).toBeGreaterThan(config.STICKER_MARGIN_MIN);
    expect(out.d).toBeLessThan(2);
  });

  it("цвет ровно между красным и оранжевым отрыва не даёт", () => {
    const between: RGB = [222, 88, 48];
    const out = stickerConfidence(rgb2lab(between), REFS);
    expect(out.margin).toBeLessThan(config.STICKER_MARGIN_MIN);
  });
});

describe("confidentCells", () => {
  it("чистая грань уверена во всех девяти ячейках", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    expect(confidentCells(labs, REFS, ALL_KEPT)).toBe(9);
  });

  it("ячейка, где блик съел пиксели, уверенной не считается", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    const kept = [...ALL_KEPT];
    kept[3] = 0.05;
    expect(confidentCells(labs, REFS, kept)).toBe(8);
  });

  it("цвет далеко от всех эталонов (мимо кубика) уверенным не считается", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    // Тёмно-серая стена: далека от всех шести эталонов, но ни к одному не
    // «прилипает» — ровно случай «рамка съехала с кубика».
    labs[0] = rgb2lab([88, 84, 90]);
    expect(confidentCells(labs, REFS, ALL_KEPT)).toBe(8);
  });
});
