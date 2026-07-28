// Сквозная проверка цветового пайплайна на синтетике: свет уехал, часть ячеек
// побита бликом, одна наклейка прочиталась бы чужим цветом. По отдельности эти
// механизмы уже проверены; здесь важно, что вместе они дают ЧИСТОЕ чтение —
// именно этот набор бед и был в живом багрепорте.

import { describe, it, expect } from "vitest";
import {
  assignQuota,
  applyLightGain,
  normalizeFaceByCenter,
  rgb2lab,
  type Refs,
  type RGB,
} from "../../src/vision/colors";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;
const ORDER = ["U", "R", "F", "D", "L", "B"] as const;

describe("цветовой пайплайн целиком", () => {
  it("тёплый свет + сбитая наклейка: 54 из 54 после нормировки и квот", () => {
    const warm: [number, number, number] = [1.16, 1.0, 0.82];

    // Собранный кубик под тёплой лампой.
    const faces = ORDER.map((name) =>
      Array.from({ length: 9 }, () => applyLightGain(REF_RGB[name], warm)),
    );
    // Одна белая наклейка поймала тёплый блик и сама по себе читается оранжевой.
    faces[0][2] = [252, 214, 168];

    const fixed = faces.map((face) =>
      normalizeFaceByCenter(face, REFS[ORDER[faces.indexOf(face)]]),
    );
    const labs = fixed.flat().map((rgb) => rgb2lab(rgb));
    const centerIdx = ORDER.map((_, i) => i * 9 + 4);
    const { assignment, balanced } = assignQuota(labs, REFS, centerIdx);

    expect(balanced).toBe(true);
    const expected = ORDER.flatMap((name) => Array(9).fill(name));
    expect(assignment).toEqual(expected);
  });

  it("без нормировки тот же кадр читается хуже — подпорки не заменяют свет", () => {
    const warm: [number, number, number] = [1.35, 1.0, 0.62];
    const faces = ORDER.map((name) =>
      Array.from({ length: 9 }, () => applyLightGain(REF_RGB[name], warm)),
    );

    const rawLabs = faces.flat().map((rgb) => rgb2lab(rgb));
    const centerIdx = ORDER.map((_, i) => i * 9 + 4);
    const raw = assignQuota(rawLabs, REFS, centerIdx);

    const fixedLabs = faces
      .map((face, i) => normalizeFaceByCenter(face, REFS[ORDER[i]]))
      .flat()
      .map((rgb) => rgb2lab(rgb));
    const fixed = assignQuota(fixedLabs, REFS, centerIdx);

    const expected = ORDER.flatMap((name) => Array(9).fill(name));
    const correct = (a: string[]) => a.filter((v, i) => v === expected[i]).length;
    expect(correct(fixed.assignment)).toBeGreaterThanOrEqual(correct(raw.assignment));
    expect(correct(fixed.assignment)).toBe(54);
  });
});
