// Подгонка сетки под реальное положение грани. Проверяем на синтетическом кадре:
// кубик нарисован не по центру и меньше рамки — ровно та ситуация, в которой
// раньше ячейки съезжали на фон и белая наклейка читалась как красная.

import { describe, it, expect } from "vitest";
import {
  fitFaceRegion,
  regionCost,
  candidateRegions,
  gapContrast,
  edgeContrast,
  type Patch,
} from "../../src/vision/faceFit";
import { deltaE, rgb2lab, type ColorName, type Refs, type RGB } from "../../src/vision/colors";
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
const NAMES = Object.keys(REF_RGB) as ColorName[];

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

// ---------------------------------------------------------------------------
// Stickerless: план `swarm-report/stickerless-face-fit-plan.md`.
// ---------------------------------------------------------------------------

// Фон при свободной хватке (живой прогон 2026-08-05): RGB(162,124,99)..
// (194,129,104) — телесный тон руки/стола, а не сиреневая стена выше.
const SKIN: RGB = [178, 127, 102];

/**
 * Грань, повёрнутая на `deg` и слегка трапецеидальная (`keystone`), — та же
 * сцена, которой шаг 0 плана доказал, что верный кандидат в переборе ЕСТЬ.
 * Рисуется обратным отображением: для каждого пикселя экрана считаем, куда он
 * попадает в системе координат грани. `stickerless=true` — цвет наклейки без
 * зазора продолжается до самого шва (никакого тёмного корпуса).
 */
function rotatedScene(
  size: number,
  cx: number,
  cy: number,
  side: number,
  deg: number,
  keystone: number,
  stickerless: boolean,
  bg: RGB,
  faceLabels: readonly string[],
): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const cell = side / 3;
  const gap = stickerless ? 0 : Math.max(1, Math.round(cell * 0.08));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      let u = dx * cos - dy * sin;
      const v = dx * sin + dy * cos;
      u = u * (1 + keystone * (v / side));

      let c: RGB = bg;
      if (Math.abs(u) < side / 2 && Math.abs(v) < side / 2) {
        const col = Math.min(2, Math.floor((u + side / 2) / cell));
        const row = Math.min(2, Math.floor((v + side / 2) / cell));
        const inU = u + side / 2 - col * cell;
        const inV = v + side / 2 - row * cell;
        c =
          inU > gap && inU < cell - gap && inV > gap && inV < cell - gap
            ? REF_RGB[faceLabels[row * 3 + col]]
            : stickerless
              ? REF_RGB[faceLabels[row * 3 + col]]
              : PLASTIC;
      }
      const i = (y * size + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

/** Средний цвет центральных 50% ячейки → ближайший эталон (argmin-чтение). */
function readCells(patch: Patch, r: { x: number; y: number; side: number }): string[] {
  const cw = r.side / 3;
  const out: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = r.x + col * cw + cw * 0.25;
      const y0 = r.y + row * cw + cw * 0.25;
      const w = cw * 0.5;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = Math.round(y0); y < Math.round(y0 + w); y++) {
        for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
          if (x < 0 || y < 0 || x >= patch.size || y >= patch.size) continue;
          const i = (y * patch.size + x) * 4;
          sr += patch.data[i];
          sg += patch.data[i + 1];
          sb += patch.data[i + 2];
          n++;
        }
      }
      if (n === 0) {
        out.push("?");
        continue;
      }
      const lab = rgb2lab([sr / n, sg / n, sb / n] as RGB);
      let best = NAMES[0];
      let bestD = Infinity;
      for (const name of NAMES) {
        const d = deltaE(lab, REFS[name]);
        if (d < bestD) {
          bestD = d;
          best = name;
        }
      }
      out.push(best);
    }
  }
  return out;
}

const FACE_LABELS = ["U", "R", "F", "D", "L", "B", "U", "R", "F"];

describe("шаг 0 плана: верный кандидат существует в переборе (stickerless, поворот+keystone)", () => {
  it("на грани 12° с трапецией среди candidateRegions есть кандидат с правильными 9/9 метками", () => {
    const size = 240;
    const patch = rotatedScene(size, 120, 120, 150, 12, 0.12, true, SKIN, FACE_LABELS);
    let best = -1;
    for (const r of candidateRegions(size)) {
      const labels = readCells(patch, r);
      let ok = 0;
      for (let i = 0; i < 9; i++) if (labels[i] === FACE_LABELS[i]) ok++;
      if (ok > best) best = ok;
    }
    expect(best).toBe(9);
  });
});

/**
 * Конечная stickerless-грань БЕЗ поворота: заданного размера, окружена
 * телесным фоном. `off` — отступ грани от края патча.
 */
function stickerlessFace(
  size: number,
  off: number,
  cellSize: number,
  labels: readonly string[],
): Patch {
  const data = new Uint8ClampedArray(size * size * 4);
  const faceSide = cellSize * 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c: RGB = SKIN;
      if (x >= off && x < off + faceSide && y >= off && y < off + faceSide) {
        const col = Math.min(2, Math.floor((x - off) / cellSize));
        const row = Math.min(2, Math.floor((y - off) / cellSize));
        c = REF_RGB[labels[row * 3 + col]];
      }
      const i = (y * size + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

// off=48, cellSize=48: грань [48,192)×[48,192), кандидат-сторона 144. Сдвиг на
// целую свою ячейку (48px) вправо частично уходит на фон одной колонкой — та
// же ситуация, которую ищет перебор в реальном кадре.
const SLESS_OFF = 48;
const SLESS_CELL = 48;

describe("A2 (тождество): EDGE_WEIGHT=0 не меняет regionCost — новое слагаемое обнуляется", () => {
  // При weight=0 добавка deficitEdge*edgeWeight равна 0 АРИФМЕТИЧЕСКИ, при
  // любом deficitEdge и любом edgeTarget — это и есть побитовое совпадение со
  // старой формулой (best + spread*0.35 + deficit*gapWeight), без copy-paste
  // старого кода в тест: если бы edgeTarget подмешивался мимо веса, значение
  // отличалось бы.
  it.each([
    [
      "сползшая сетка (marginWith фикстура)",
      () => scene(120, 22, 0, 74, MIXED_FACE, BRIGHT_WALL),
      { x: 22, y: 0, side: 74 },
    ],
    ["грань в углу рамки", () => scene(120, 8, 10, 72, MIXED_FACE), { x: 8, y: 10, side: 72 }],
    [
      "stickerless без поворота",
      () => stickerlessFace(240, SLESS_OFF, SLESS_CELL, FACE_LABELS),
      { x: SLESS_OFF, y: SLESS_OFF, side: SLESS_CELL * 3 },
    ],
  ] as const)("%s", (_name, makePatch, region) => {
    const patch = makePatch();
    const c1 = regionCost(patch, region, REFS, 0.5, 12, 1.0, 0.12, 0, 0, 0);
    const c2 = regionCost(patch, region, REFS, 0.5, 12, 1.0, 0.12, 0, 999, 0);
    expect(c1).toBe(c2);
  });

  it("marginWith (сползшая сетка) не меняется, если EDGE_WEIGHT=0, каким бы ни был EDGE_TARGET", () => {
    const patch = scene(120, 22, 0, 74, MIXED_FACE, BRIGHT_WALL);
    const onFace = { x: 22, y: 0, side: 74 };
    const slippedDown = { x: 22, y: 25, side: 74 };
    const marginAt = (edgeTarget: number) =>
      regionCost(patch, slippedDown, REFS, 0.5, 12, 1.0, 0.12, 0, edgeTarget, 0) -
      regionCost(patch, onFace, REFS, 0.5, 12, 1.0, 0.12, 0, edgeTarget, 0);
    expect(marginAt(0)).toBe(marginAt(999));
  });
});

describe("пин причины: на stickerless щель молчит, граница — нет", () => {
  it("выровненная грань: gapContrast недостаточен, edgeContrast выше цели", () => {
    const patch = stickerlessFace(240, SLESS_OFF, SLESS_CELL, FACE_LABELS);
    const aligned = { x: SLESS_OFF, y: SLESS_OFF, side: SLESS_CELL * 3 };
    // «В основном 0..10» из живого отчёта — щель у stickerless недостаточна,
    // сколько бы её ни считали: до FACE_FIT_GAP_TARGET (12) она не дотягивает.
    expect(gapContrast(patch, aligned)).toBeLessThan(config.FACE_FIT_GAP_TARGET);
    expect(edgeContrast(patch, aligned)).toBeGreaterThan(config.FACE_FIT_EDGE_TARGET);
  });
});

describe("A4/A5: stickerless — съехавшая сетка дороже выровненной ИМЕННО из-за границы", () => {
  const patch = () => stickerlessFace(240, SLESS_OFF, SLESS_CELL, FACE_LABELS);
  const aligned = { x: SLESS_OFF, y: SLESS_OFF, side: SLESS_CELL * 3 };
  const shift1cell = { x: SLESS_OFF + SLESS_CELL, y: SLESS_OFF, side: SLESS_CELL * 3 };
  const shiftHalfCell = { x: SLESS_OFF + SLESS_CELL / 2, y: SLESS_OFF, side: SLESS_CELL * 3 };

  it("A4: сдвиг на целую ячейку дороже по новой формуле, и разница ИМЕННО от границы (EDGE_WEIGHT=0 даёт меньший отрыв)", () => {
    const p = patch();
    const marginWithEdge = regionCost(p, shift1cell, REFS) - regionCost(p, aligned, REFS);
    const marginWithoutEdge =
      regionCost(p, shift1cell, REFS, 0.5, 12, 1.0, 0.12, 0, config.FACE_FIT_EDGE_TARGET, 0) -
      regionCost(p, aligned, REFS, 0.5, 12, 1.0, 0.12, 0, config.FACE_FIT_EDGE_TARGET, 0);
    expect(marginWithEdge).toBeGreaterThan(0);
    expect(marginWithEdge).toBeGreaterThan(marginWithoutEdge);
  });

  it("A5: сдвиг на половину ячейки тоже дороже выровненного", () => {
    const p = patch();
    expect(regionCost(p, shiftHalfCell, REFS)).toBeGreaterThan(regionCost(p, aligned, REFS));
  });
});

describe("A7/anti-запор: decided на существующих стикерных фикстурах и на однотонной грани", () => {
  it("decided === true на всех существующих стикерных сценах (телеметрия не запирает чтение)", () => {
    const cases: { patch: Patch; label: string }[] = [
      { patch: scene(120, 8, 10, 72, MIXED_FACE), label: "грань в углу рамки" },
      { patch: scene(180, 46, 52, 88, MIXED_FACE), label: "грань в половину рамки" },
      { patch: scene(180, 37, 29, 96, MIXED_FACE), label: "смещение не в узел грубой сетки" },
      { patch: scene(120, 0, 0, 120, WHITE_FACE), label: "грань во весь патч" },
      { patch: scene(120, 22, 0, 74, MIXED_FACE, BRIGHT_WALL), label: "светлый фон под кубиком" },
    ];
    for (const { patch, label } of cases) {
      const fit = fitFaceRegion(patch, REFS);
      expect(fit.decided, label).toBe(true);
    }
  });

  it("anti-запор: однотонная (собранная) stickerless-грань тоже decided === true", () => {
    const patch = stickerlessFace(240, SLESS_OFF, SLESS_CELL, Array(9).fill("U"));
    const fit = fitFaceRegion(patch, REFS);
    expect(fit.decided).toBe(true);
  });

  // ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (не A1-A10, отдельная заметка честности): margin
  // сравнивает победителя только с соперниками, чьи 9 меток-аргминов
  // ОТЛИЧАЮТСЯ. На идеально ровной стене чтение не зависит от положения сетки
  // ВООБЩЕ — любой кандидат читает одни и те же 9 меток, соперников с другим
  // ответом нет, margin = Infinity, decided = true. Это НЕ баг охвата, а прямое
  // следствие формулы margin/decided, заданной постановщиком буквально
  // («только те, чьи метки ОТЛИЧАЮТСЯ»): у ровной стены грань подгонки не
  // определяет НЕ фазу сетки (та тут действительно не важна — ответ один и тот
  // же при любой фазе), а факт «это вообще не кубик» — для этого есть другие
  // замки (FACE_MAX_MEDIAN_DE и т.п.), decided их не подменяет.
  it("на ровной стене decided тривиально true — margin не ловит «это не кубик», это не его работа", () => {
    const patch = flat(120, WALL);
    const fit = fitFaceRegion(patch, REFS);
    expect(fit.margin).toBe(Infinity);
    expect(fit.decided).toBe(true);
  });
});
