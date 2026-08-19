// Метрика выбора цвета против метрики принадлежности кубику.
//
// Живой прогон 2026-08-20 (собранный кубик, stickerless, LED): 51/54, и все три
// промаха — нижний ряд синей грани, прочитанный белым. Ячейки сняты чисто
// (kept 100%, ни блика, ни промаха сетки), просто освещены ярче остальных:
// цветовой тон синий, светлота выше на два десятка. Обычная метрика считает
// разницу света разницей цвета и отвечает «белый».

import { describe, it, expect } from "vitest";
import {
  COLOR_NAMES,
  deltaE,
  deltaEClassify,
  minSeparation,
  rgb2lab,
  type Refs,
  type RGB,
} from "../../src/vision/colors";
import { stickerConfidence, faceMedianDE } from "../../src/vision/hooks/useCubeReader";
import { config } from "../../src/vision/config";

// Эталоны той самой сессии.
const REF_RGB: Record<string, RGB> = {
  U: [178, 198, 216],
  R: [249, 52, 54],
  F: [0, 171, 81],
  D: [195, 201, 66],
  L: [255, 116, 46],
  B: [9, 101, 207],
};
const REFS = Object.fromEntries(
  Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)]),
) as unknown as Refs;

/** Три ячейки синей грани, прочитанные белыми. */
const WASHED_BLUE: RGB[] = [
  [89, 159, 249],
  [97, 162, 250],
  [96, 161, 249],
];

function nearest(rgb: RGB, metric: (a: number[], b: number[]) => number): string {
  const lab = rgb2lab(rgb);
  return [...COLOR_NAMES].sort((x, y) => metric(lab, REFS[x]) - metric(lab, REFS[y]))[0] as string;
}

describe("deltaEClassify", () => {
  it("обычная метрика на этих ячейках ошибается — иначе чинить было бы нечего", () => {
    for (const rgb of WASHED_BLUE) {
      expect(nearest(rgb, deltaE), String(rgb)).toBe("U");
    }
  });

  it("метрика выбора читает пересвеченный синий синим", () => {
    for (const rgb of WASHED_BLUE) {
      expect(nearest(rgb, deltaEClassify), String(rgb)).toBe("B");
    }
  });

  it("и делает это с запасом, а не на границе", () => {
    for (const rgb of WASHED_BLUE) {
      const lab = rgb2lab(rgb);
      const toBlue = deltaEClassify(lab, REFS.B);
      const toWhite = deltaEClassify(lab, REFS.U);
      expect(toWhite - toBlue, String(rgb)).toBeGreaterThan(1.5);
    }
  });

  // Цена ослабления светлоты: эталоны сближаются. Проверяем, что запас до
  // порога вердикта остаётся, иначе лечение хуже болезни.
  it("эталоны остаются различимы: пара R–L держится выше порога вердикта", () => {
    const plain = minSeparation(REFS);
    let worst = Infinity;
    for (let i = 0; i < COLOR_NAMES.length; i++) {
      for (let j = i + 1; j < COLOR_NAMES.length; j++) {
        worst = Math.min(worst, deltaEClassify(REFS[COLOR_NAMES[i]], REFS[COLOR_NAMES[j]]));
      }
    }
    expect(plain.de).toBeGreaterThan(worst); // ослабление действительно сближает
    expect(worst).toBeGreaterThan(config.CALIB_MIN_SEPARATION_DE + 3);
  });
});

describe("stickerConfidence — две метрики в одном ответе", () => {
  // `d` обязан остаться на обычной метрике: пороги «это вообще наклейка»
  // калиброваны на ней, и именно светлота отличает щель и стол от наклейки.
  it("расстояние считается обычной метрикой, а выбор — метрикой выбора", () => {
    const lab = rgb2lab(WASHED_BLUE[0]);
    const { best, d } = stickerConfidence(lab, REFS);
    expect(best).toBe("B");
    expect(d).toBeCloseTo(deltaE(lab, REFS.B), 6);
    expect(d).not.toBeCloseTo(deltaEClassify(lab, REFS.B), 6);
  });

  it("замок «в рамке не кубик» ослабление светлоты не задело", () => {
    // Тёмная щель между деталями: далека от всех шести именно по светлоте.
    const gap: RGB = [26, 28, 30];
    const face = Array.from({ length: 9 }, () => rgb2lab(gap));
    expect(faceMedianDE(face, REFS)).toBeGreaterThan(config.FACE_MAX_MEDIAN_DE);
  });
});
