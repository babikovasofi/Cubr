import { describe, expect, it } from "vitest";

import { chroma, rgb2lab } from "../../src/vision/colors";
import { glareFilmSuspect, formatReport, type CellDiag } from "../../src/vision/accuracy";
import { config } from "../../src/vision/config";
import type { AccuracyReport } from "../../src/vision/accuracy";
import type { Face } from "../../src/vision/cubeState";

/** Эталон белого этой сессии — живая калибровка 2026-08-21. */
const WHITE_L = rgb2lab([213, 207, 197])[0];

function diag(rgb: [number, number, number], over: Partial<CellDiag> = {}): CellDiag {
  const lab = rgb2lab(rgb);
  return {
    rgb,
    kept: 1,
    best: "U",
    bestDE: 2,
    second: "D",
    secondDE: 24,
    skin: 0,
    lift: lab[0] - WHITE_L,
    chroma: chroma(lab),
    ...over,
  };
}

describe("chroma", () => {
  it("равна нулю у нейтрально-серого и растёт с насыщенностью", () => {
    expect(chroma([50, 0, 0])).toBe(0);
    expect(chroma([50, 3, 4])).toBeCloseTo(5, 6);
    // Настоящая цветная наклейка живого прогона против её же белёсого двойника.
    expect(chroma(rgb2lab([18, 158, 72]))).toBeGreaterThan(30);
    expect(chroma(rgb2lab([231, 225, 216]))).toBeLessThan(config.GLARE_MAX_CHROMA);
  });
});

describe("glareFilmSuspect", () => {
  it("ловит ячейки живого прогона, которые kept пропустил", () => {
    // Обе прочитаны белыми при ожидании зелёного/красного, kept 75% и 100%.
    for (const rgb of [
      [224, 219, 210],
      [231, 225, 216],
    ] as [number, number, number][]) {
      const d = diag(rgb);
      expect(d.kept).toBeGreaterThanOrEqual(config.CELL_MIN_KEPT_FRAC);
      expect(glareFilmSuspect(d)).toBe(true);
    }
  });

  it("не трогает честный белый: он не светлее снятого белого", () => {
    expect(glareFilmSuspect(diag([213, 207, 197]))).toBe(false);
    expect(glareFilmSuspect(diag([206, 208, 205]))).toBe(false);
  });

  it("не трогает яркую цветную наклейку: хрома на месте", () => {
    // Жёлтая грань светлее белого эталона, но цвет у неё есть.
    const d = diag([255, 241, 90]);
    expect(d.lift!).toBeGreaterThan(config.GLARE_LIFT_L);
    expect(glareFilmSuspect(d)).toBe(false);
  });

  it("молчит на отчётах без замера — оба поля обязательны", () => {
    expect(glareFilmSuspect(diag([231, 225, 216], { lift: undefined }))).toBe(false);
    expect(glareFilmSuspect(diag([231, 225, 216], { chroma: undefined }))).toBe(false);
  });
});

describe("formatReport: строка плёнки блика", () => {
  const emptyConfusion = () => {
    const faces: Face[] = ["U", "R", "F", "D", "L", "B"];
    const m = {} as Record<Face, Record<Face, number>>;
    for (const a of faces) {
      m[a] = {} as Record<Face, number>;
      for (const b of faces) m[a][b] = 0;
    }
    return m;
  };

  const report = (): AccuracyReport => ({
    total: 54,
    correct: 53,
    fraction: 53 / 54,
    pass: true,
    stickers: [{ index: 8, face: "U", cellInFace: 8, read: "U", expected: "F", correct: false }],
    confusion: emptyConfusion(),
  });

  it("считает подозрительные ячейки и сколько из них ушло в промах", () => {
    const diags: CellDiag[] = new Array(54).fill(null).map(() => diag([213, 207, 197]));
    diags[8] = diag([231, 225, 216]); // промах
    diags[20] = diag([224, 219, 210]); // не промах
    const out = formatReport(report(), diags);
    expect(out).toContain("плёнка блика, kept целый): 2, из них в промахах: 1");
    // И у самой строки промаха — пометка с числами.
    expect(out).toMatch(/ПЛЁНКА БЛИКА: светлее белого на \d+\.\d, хрома \d+\.\d/);
  });

  it("не печатает строку, если замера нет (старый отчёт)", () => {
    const diags: CellDiag[] = new Array(54)
      .fill(null)
      .map(() => diag([213, 207, 197], { lift: undefined, chroma: undefined }));
    expect(formatReport(report(), diags)).not.toContain("плёнка блика");
  });
});
