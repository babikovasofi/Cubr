// Подгонка сетки под реальное положение грани. Проверяем на синтетическом кадре:
// кубик нарисован не по центру и меньше рамки — ровно та ситуация, в которой
// раньше ячейки съезжали на фон и белая наклейка читалась как красная.

import { describe, it, expect } from "vitest";
import {
  fitFaceRegion,
  regionCost,
  candidateRegions,
  gapContrast,
  type Patch,
} from "../../src/vision/faceFit";
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
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;

const WALL: RGB = [150, 130, 160]; // сиреневая стена, как на живом кадре
// Светлый фон кафе: стол/засвеченное окно. Похож на белый эталон, поэтому по
// одному «ячейка близка к какому-нибудь эталону» неотличим от белой наклейки.
const BRIGHT_WALL: RGB = [228, 232, 236];
const PLASTIC: RGB = [24, 24, 26]; // корпус кубика: щели между наклейками

/**
 * Патч со «сценой»: фон-стена, на ней грань кубика (9 наклеек с тёмными щелями)
 * в заданном месте и заданного размера.
 *
 * Щели — это тёмный корпус кубика, а не просвет фона: у настоящего кубика между
 * наклейками чёрный пластик, и именно на нём держится структурный признак
 * решётки в regionCost.
 */
function scene(
  size: number,
  faceX: number,
  faceY: number,
  faceSide: number,
  colors: RGB[],
  bg: RGB = WALL,
): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number, c: RGB) => {
    const i = (y * size + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, bg);

  const cell = faceSide / 3;
  const gap = Math.max(1, Math.round(cell * 0.08)); // щель между наклейками
  for (let y = Math.round(faceY); y < Math.round(faceY + faceSide); y++) {
    for (let x = Math.round(faceX); x < Math.round(faceX + faceSide); x++) {
      if (x >= 0 && y >= 0 && x < size && y < size) put(x, y, PLASTIC);
    }
  }
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

/** Патч без кубика вообще: ровная поверхность одного цвета. */
function flat(size: number, c: RGB): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
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

  // Живой прогон 2026-08-04: «ПОДОГНАНА» на всех шести гранях при контрасте щелей
  // около нуля — решётку не нашли нигде. Причина оказалась не в оценке, а в
  // переборе: он начинался с масштаба 0.62, то есть молча требовал, чтобы грань
  // занимала минимум две трети рамки. Кубик подальше от камеры давал грань в
  // половину, и правильного положения в переборе не существовало вовсе.
  it("находит грань, занимающую половину рамки — кубик держали дальше", () => {
    const size = 180;
    const side = 88; // 0.49 патча: вне прежнего диапазона масштабов
    const patch = scene(size, 46, 52, side, MIXED_FACE);
    const fit = fitFaceRegion(patch, REFS);

    const cx = fit.region.x + fit.region.side / 2;
    const cy = fit.region.y + fit.region.side / 2;
    expect(Math.abs(cx - (46 + side / 2))).toBeLessThan(side / 6);
    expect(Math.abs(cy - (52 + side / 2))).toBeLessThan(side / 6);
    expect(Math.abs(fit.region.side - side)).toBeLessThan(side * 0.25);
    // И решётка при этом найдена: ровно то число, что на живом прогоне было ~0.
    expect(gapContrast(patch, fit.region)).toBeGreaterThan(config.FACE_FIT_GAP_TARGET);
  });

  it("уточнение садится точнее четверти ячейки — грубого шага мало", () => {
    const size = 180;
    const side = 96;
    // Смещение заведомо не попадает в узлы грубой сетки.
    const patch = scene(size, 37, 29, side, MIXED_FACE);
    const fit = fitFaceRegion(patch, REFS);
    const cell = side / 3;
    expect(Math.abs(fit.region.x - 37)).toBeLessThan(cell * 0.25);
    expect(Math.abs(fit.region.y - 29)).toBeLessThan(cell * 0.25);
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

  // Живой отказ из /accuracy: кубик в верхней части рамки, под ним светлый стол.
  // Нижний ряд ячеек садился на стол, читался как U — и стоимость оставалась
  // низкой, потому что светлый фон похож на белый эталон.
  it("не съезжает с кубика на светлый фон", () => {
    const size = 120;
    const patch = scene(size, 22, 0, 74, MIXED_FACE, BRIGHT_WALL);
    const fit = fitFaceRegion(patch, REFS);

    const cy = fit.region.y + fit.region.side / 2;
    expect(Math.abs(cy - 37)).toBeLessThan(15);
    // Нижняя граница сетки не уходит на стол дальше десятой доли стороны.
    expect(fit.region.y + fit.region.side).toBeLessThan(74 + 7.4);
  });

  it("на светлом фоне сползшая вниз сетка дороже сетки на грани", () => {
    const size = 120;
    const patch = scene(size, 22, 0, 74, MIXED_FACE, BRIGHT_WALL);
    const onFace = { x: 22, y: 0, side: 74 };
    const slippedDown = { x: 22, y: 25, side: 74 }; // нижний ряд на столе

    expect(regionCost(patch, onFace, REFS)).toBeLessThan(regionCost(patch, slippedDown, REFS));

    // Причина живого отказа — не знак разницы, а её РАЗМЕР. Без структурного
    // признака (вес 0) отрыв меньше FACE_FIT_MIN_GAIN, то есть подгонка такой
    // разнице не верит и остаётся на рамке; на живом кадре шум съедает её
    // целиком. Признак решётки поднимает отрыв на порядок.
    const marginWithout =
      regionCost(patch, slippedDown, REFS, 0.5, 12, 0) -
      regionCost(patch, onFace, REFS, 0.5, 12, 0);
    const marginWith = regionCost(patch, slippedDown, REFS) - regionCost(patch, onFace, REFS);
    expect(marginWithout).toBeLessThan(config.FACE_FIT_MIN_GAIN);
    expect(marginWith).toBeGreaterThan(config.FACE_FIT_MIN_GAIN * 2);
  });
});

describe("gapContrast", () => {
  it("у правильно севшей сетки щели заметно темнее наклеек", () => {
    const patch = scene(120, 22, 0, 74, MIXED_FACE, BRIGHT_WALL);
    expect(gapContrast(patch, { x: 22, y: 0, side: 74 })).toBeGreaterThan(12);
  });

  it("на ровной поверхности решётки нет ни при каком масштабе", () => {
    for (const bg of [BRIGHT_WALL, WALL]) {
      const patch = flat(120, bg);
      for (const side of [120, 96, 74]) {
        expect(gapContrast(patch, { x: 0, y: 0, side })).toBeLessThan(3);
      }
    }
  });

  it("сетка, съехавшая на половину ячейки, решётку теряет", () => {
    const patch = scene(120, 22, 0, 74, MIXED_FACE, BRIGHT_WALL);
    const aligned = gapContrast(patch, { x: 22, y: 0, side: 74 });
    const shifted = gapContrast(patch, { x: 22 + 74 / 6, y: 74 / 6, side: 74 });
    expect(shifted).toBeLessThan(aligned);
  });
});
