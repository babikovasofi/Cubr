// Съёмка грани: медиана по нескольким кадрам и объяснение отказа.
// Живая жалоба — «кубик всегда не читается»; тупиковое «повтори» без причины
// делает её неразрешимой для человека.

import { describe, it, expect } from "vitest";
import { medianAcrossFrames, rgb2lab, type Refs, type RGB } from "../../src/vision/colors";
import { explainFace, confidentCells } from "../../src/vision/hooks/useCubeReader";
import { config } from "../../src/vision/config";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;
const KEPT_OK = Array(9).fill(1);

describe("medianAcrossFrames", () => {
  it("одиночный смазанный кадр не портит ячейку", () => {
    const good: RGB[] = Array(9).fill(REF_RGB.U);
    const blurred: RGB[] = Array(9).fill([120, 90, 70] as RGB);
    const out = medianAcrossFrames([good, good, blurred, good, good]);
    expect(out[0][0]).toBeGreaterThan(200);
  });

  it("если кадров нет, ничего не выдумывает", () => {
    expect(medianAcrossFrames([])).toEqual([]);
  });

  it("считает по каждой ячейке отдельно", () => {
    const a: RGB[] = [REF_RGB.U, REF_RGB.R, REF_RGB.F, ...Array(6).fill(REF_RGB.U)];
    const out = medianAcrossFrames([a, a, a]);
    expect(out[1]).toEqual(REF_RGB.R);
    expect(out[2]).toEqual(REF_RGB.F);
  });
});

describe("explainFace", () => {
  it("называет ячейки, которые съел блик", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    const kept = [...KEPT_OK];
    kept[2] = 0.05;
    expect(explainFace(labs, REFS, kept)).toMatch(/блик.*3/);
  });

  it("отдельно говорит про рамку мимо кубика", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    // Тёмный фон за кубиком: дальше STICKER_MAX_DELTA_E от каждого эталона.
    labs[0] = rgb2lab([40, 38, 44]);
    expect(explainFace(labs, REFS, KEPT_OK)).toMatch(/далеко от всех цветов/);
  });

  it("отдельно говорит про спорный цвет", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    labs[4] = rgb2lab([222, 88, 48]); // между красным и оранжевым
    const text = explainFace(labs, REFS, KEPT_OK);
    expect(text).toMatch(/спорный цвет/);
  });

  it("на чистой грани не выдумывает проблем", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.F));
    expect(confidentCells(labs, REFS, KEPT_OK)).toBe(9);
    expect(explainFace(labs, REFS, KEPT_OK)).toBe("цвета читаются, но неустойчиво");
  });
});

describe("пороги съёмки", () => {
  it("кадров в серии больше одного, зазор не нулевой", () => {
    expect(config.CAPTURE_FRAMES).toBeGreaterThan(1);
    expect(config.CAPTURE_FRAME_GAP_MS).toBeGreaterThan(0);
  });

  it("отказ по неуверенности не бесконечен", () => {
    expect(config.FACE_CONFIDENCE_RETRIES).toBeGreaterThanOrEqual(1);
    expect(config.FACE_CONFIDENCE_RETRIES).toBeLessThanOrEqual(3);
  });
});
