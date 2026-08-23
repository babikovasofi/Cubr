// Квоты 9×6 не должны чинить одну сломанную грань за счёт пяти целых.
//
// Живые прогоны 2026-08-23 (день, stickerless): продуктовое чтение выходило ХУЖЕ
// сырого — 47/54 против 50/54 и 43/54 против 49/54. В обоих случаях одна съёмка
// нахватала ячеек соседней грани, баланс цветов ушёл на 2, и раздача затыкала
// дыру, двигая верно прочитанные ячейки на других гранях.

import { describe, expect, it } from "vitest";

import { classifyWithQuota } from "../../src/vision/hooks/useCubeReader";
import { COLOR_NAMES, rgb2lab, type Lab, type Refs } from "../../src/vision/colors";
import { config } from "../../src/vision/config";
import type { Face } from "../../src/vision/cubeState";

/** Эталоны живой калибровки 2026-08-23. */
const REFS: Refs = {
  U: rgb2lab([197, 201, 195]),
  R: rgb2lab([188, 38, 36]),
  F: rgb2lab([30, 143, 84]),
  D: rgb2lab([195, 187, 63]),
  L: rgb2lab([246, 118, 76]),
  B: rgb2lab([20, 89, 164]),
};

const CENTERS = [...COLOR_NAMES] as string[] as Face[];

/** Шесть одноцветных граней: по девять ячеек каждого цвета, точно в эталон. */
function solvedFaces(): Lab[][] {
  return COLOR_NAMES.map((name) => new Array(9).fill(null).map(() => [...REFS[name]] as Lab));
}

/** Сколько ячеек прочитано не тем цветом, которым грань выложена. */
function wrongOutside(grids: Face[][], faceIdx: number): number {
  let n = 0;
  for (let k = 0; k < 6; k++) {
    if (k === faceIdx) continue;
    for (let i = 0; i < 9; i++) if (grids[k][i] !== (COLOR_NAMES[k] as string)) n += 1;
  }
  return n;
}

describe("classifyWithQuota: замок на перекос баланса", () => {
  it("чистое чтение раздаётся без изменений", () => {
    const out = classifyWithQuota(solvedFaces(), REFS, CENTERS);
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 9; i++) expect(out[k][i]).toBe(COLOR_NAMES[k]);
    }
  });

  it("одна заблудившаяся наклейка по-прежнему чинится квотами", () => {
    const faces = solvedFaces();
    // Ячейка грани L снялась почти белой: argmin отдаст ей белый, белых станет
    // десять. Перекос 1 — посылка квот верна, они возвращают её на место.
    faces[4][0] = rgb2lab([200, 203, 198]);
    const out = classifyWithQuota(faces, REFS, CENTERS);
    expect(out[4][0]).toBe("L");
  });

  it("сломанная грань не двигает ячейки на других гранях", () => {
    const faces = solvedFaces();
    // Две ячейки первой съёмки сняты с соседней грани — ровно живой случай.
    faces[0][0] = [...REFS.B] as Lab;
    faces[0][2] = [...REFS.B] as Lab;

    const out = classifyWithQuota(faces, REFS, CENTERS);
    expect(wrongOutside(out, 0)).toBe(0);
    // Ошибка осталась там, где случилась: обе ячейки читаются синими.
    expect(out[0][0]).toBe("B");
    expect(out[0][2]).toBe("B");
  });

  it("порог перекоса взят из конфига, а не вшит", () => {
    const faces = solvedFaces();
    for (let i = 0; i <= config.QUOTA_MAX_SKEW; i++) faces[0][i] = [...REFS.B] as Lab;
    // На единицу больше разрешённого — квоты не применяются вовсе.
    expect(classifyWithQuota(faces, REFS, CENTERS)[0][0]).toBe("B");
  });

  it("без раскладки центров квоты не применяются (нечего пиннить)", () => {
    const faces = solvedFaces();
    faces[0][0] = [...REFS.B] as Lab;
    expect(classifyWithQuota(faces, REFS, null)[0][0]).toBe("B");
  });
});

describe("замок нужен: без него та же колода портит соседние грани", () => {
  it("при выключенном пороге раздача вытесняет верные ячейки", () => {
    const faces = solvedFaces();
    faces[0][0] = [...REFS.B] as Lab;
    faces[0][2] = [...REFS.B] as Lab;

    const saved = config.QUOTA_MAX_SKEW;
    try {
      // Прежнее поведение: квоты применяются при любом перекосе.
      config.QUOTA_MAX_SKEW = 54;
      const before = classifyWithQuota(faces, REFS, CENTERS);
      expect(wrongOutside(before, 0)).toBeGreaterThan(0);
    } finally {
      config.QUOTA_MAX_SKEW = saved;
    }
  });
});
