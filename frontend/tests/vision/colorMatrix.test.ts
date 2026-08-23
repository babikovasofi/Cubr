// Коррекция по шести центрам против уехавшего баланса белого.
//
// Ручной баланс белого на Chrome/macOS для типичной камеры недоступен, значит
// между калибровкой и чтением автоматика продолжает гулять. Диагональное
// усиление (`vonKriesGain`) правит только масштаб каналов; автобаланс меняет их
// СМЕСЬ. Матрица 3×3, снятая по шести известным центрам того же чтения, правит
// и смесь — и делает это, не заглядывая в ответ: центры известны по построению.

import { describe, it, expect } from "vitest";
import {
  fitColorMatrix,
  applyColorMatrix,
  applyLightGain,
  vonKriesGain,
  deltaE,
  rgb2lab,
  lab2rgb,
  IDENTITY_MATRIX,
  COLOR_NAMES,
  type Refs,
  type RGB,
} from "../../src/vision/colors";

// Эталоны живой сессии 2026-08-19 (stickerless, LED).
const REF_RGB: Record<string, RGB> = {
  U: [200, 211, 218],
  R: [234, 72, 71],
  F: [0, 170, 91],
  D: [207, 206, 67],
  L: [252, 118, 58],
  B: [52, 122, 218],
};
const REFS = Object.fromEntries(
  Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)]),
) as unknown as Refs;

/**
 * Камера «поплыла»: тёплый свет плюс подмешивание каналов, как это делает
 * автобаланс белого. Подобрано так, чтобы ломалась именно пара красный↔
 * оранжевый — главный hotspot R1: красный (234,72,71) уезжает почти в
 * оранжевый (252,118,58), и старые эталоны читают его неверно.
 */
function drift([r, g, b]: RGB): RGB {
  const rr = 1.06 * r + 0.1 * g;
  const gg = 0.24 * r + 0.94 * g + 0.02 * b;
  const bb = 0.02 * r + 0.06 * g + 0.84 * b;
  return [
    Math.max(0, Math.min(255, Math.round(rr))),
    Math.max(0, Math.min(255, Math.round(gg))),
    Math.max(0, Math.min(255, Math.round(bb))),
  ];
}

function nearest(rgb: RGB): string {
  const lab = rgb2lab(rgb);
  return [...COLOR_NAMES].sort((a, b) => deltaE(lab, REFS[a]) - deltaE(lab, REFS[b]))[0];
}

const NAMES = [...COLOR_NAMES];
const observedCentres = NAMES.map((n) => drift(REF_RGB[n]));
const targetCentres = NAMES.map((n) => lab2rgb(REFS[n]));

describe("fitColorMatrix", () => {
  it("возвращает центры почти точно на их эталоны", () => {
    const m = fitColorMatrix(observedCentres, targetCentres);
    for (let i = 0; i < NAMES.length; i++) {
      const de = deltaE(rgb2lab(applyColorMatrix(observedCentres[i], m)), REFS[NAMES[i]]);
      // Не ноль, и это не регуляризация: замер по сетке ridge даёт 7.14 при
      // ridge→0 и 7.49 при 0.05, то есть остаток почти весь — не от неё.
      // Он от несовпадения пространств: дрейф камеры линеен в гамма-кодированном
      // sRGB, а коррекция считается в линейном, и точного обратного
      // преобразования между ними не существует. Порог 8 — вдвое меньше
      // расстояния между ближайшей парой эталонов (R–L 16.1), значит остаток
      // заведомо не переворачивает классификацию.
      expect(de, NAMES[i]).toBeLessThan(8);
    }
  });

  // Главное утверждение: коррекция чинит ЧТЕНИЕ, а не только те шесть образцов,
  // по которым построена.
  it("уехавшие цвета снова читаются верно", () => {
    const m = fitColorMatrix(observedCentres, targetCentres);
    let wrongBefore = 0;
    let wrongAfter = 0;
    for (const n of NAMES) {
      if (nearest(drift(REF_RGB[n])) !== n) wrongBefore += 1;
      if (nearest(applyColorMatrix(drift(REF_RGB[n]), m)) !== n) wrongAfter += 1;
    }
    expect(wrongBefore).toBeGreaterThan(0); // дрейф действительно ломает чтение
    expect(wrongAfter).toBe(0);
  });

  // Ради чего вообще матрица, а не три числа: диагональ не умеет исправлять
  // подмешивание каналов, и на том же дрейфе остаётся хуже.
  it("правит лучше диагонального усиления по белому", () => {
    const m = fitColorMatrix(observedCentres, targetCentres);
    const gain = vonKriesGain(drift(REF_RGB.U), REFS.U);
    const inverse: [number, number, number] = [1 / gain[0], 1 / gain[1], 1 / gain[2]];
    let sumMatrix = 0;
    let sumDiagonal = 0;
    for (const n of NAMES) {
      const seen = drift(REF_RGB[n]);
      sumMatrix += deltaE(rgb2lab(applyColorMatrix(seen, m)), REFS[n]);
      sumDiagonal += deltaE(rgb2lab(applyLightGain(seen, inverse)), REFS[n]);
    }
    expect(sumMatrix).toBeLessThan(sumDiagonal);
  });

  it("без дрейфа почти ничего не меняет", () => {
    const m = fitColorMatrix(targetCentres, targetCentres);
    for (const n of NAMES) {
      const de = deltaE(rgb2lab(applyColorMatrix(REF_RGB[n], m)), rgb2lab(REF_RGB[n]));
      expect(de, n).toBeLessThan(3);
    }
  });

  // Патология, ради которой введена регуляризация: шесть образцов почти
  // совпадают (тёмный кадр, узкий свет), направления в пространстве нет, а
  // требуемое отображение при этом далёкое. Несглаженный МНК выдаёт матрицу,
  // идеально ложащуюся на эти шесть точек и разносящую остальные 48.
  it("на вырожденных образцах не выдаёт разболтанную матрицу", () => {
    const grey: RGB[] = [
      [100, 100, 100],
      [101, 100, 100],
      [100, 101, 100],
      [100, 100, 101],
      [99, 100, 100],
      [100, 99, 100],
    ];
    const impossible = NAMES.map((n) => lab2rgb(REFS[n]));

    const wild = fitColorMatrix(grey, impossible, 0);
    const tamed = fitColorMatrix(grey, impossible);
    const maxAbs = (m: readonly (readonly number[])[]): number =>
      Math.max(...m.flat().map(Math.abs));

    // Замерено: без регуляризации коэффициенты доходят до 63, с ней — до 1.9.
    expect(maxAbs(wild)).toBeGreaterThan(10);
    expect(maxAbs(tamed)).toBeLessThan(3);
  });

  it("меньше четырёх образцов — коррекции нет, а не выдуманная", () => {
    expect(fitColorMatrix(observedCentres.slice(0, 3), targetCentres.slice(0, 3))).toEqual(
      IDENTITY_MATRIX,
    );
  });
});
