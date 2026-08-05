// Повороты кубика целиком. Смысл: одно и то же физическое состояние, записанное
// из разных положений в руках, — это разные строки фаселетов. Сверка скрамбла
// обязана их отождествлять, иначе честно собранный скрамбл «расходится на 36
// наклеек» (реальный багрепорт).

import { describe, it, expect } from "vitest";
import {
  PERMUTATIONS,
  orientationVariants,
  rotateFacelets,
} from "../../src/vision/faceletRotations";
import { scrambleToFacelets, validateFacelets, type Face } from "../../src/vision/cubeState";
import { lenientVerify, rotateGrid } from "../../src/vision/cubeGrid";

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

describe("PERMUTATIONS", () => {
  it("ровно 24 ориентации", () => {
    expect(PERMUTATIONS).toHaveLength(24);
  });

  it("каждая — настоящая перестановка 54 индексов", () => {
    for (const perm of PERMUTATIONS) {
      expect(perm).toHaveLength(54);
      expect(new Set(perm).size).toBe(54);
    }
  });

  it("одна из них — тождественная", () => {
    expect(PERMUTATIONS.some((p) => p.every((v, i) => v === i))).toBe(true);
  });
});

describe("orientationVariants", () => {
  it("собранный кубик выглядит одинаково из любого положения", () => {
    const variants = new Set(orientationVariants(SOLVED));
    // Все 24 записи собранного кубика различаются только тем, какая грань
    // оказалась в каком слоте; сам факт «каждая грань одноцветна» сохраняется.
    for (const v of variants) {
      for (let f = 0; f < 6; f++) {
        const face = v.slice(f * 9, f * 9 + 9);
        expect(new Set(face.split("")).size).toBe(1);
      }
    }
  });

  it("любая ориентация — тот же кубик: после переобозначения по центрам он легален", () => {
    // Поворот кубика целиком переносит цвета в другие слоты, поэтому «сырая»
    // повёрнутая строка не проходит validateFacelets: там U-центр уже не «U».
    // Переобозначим цвета по центрам самой строки — состояние обязано остаться
    // легальным, иначе поворот что-то испортил.
    const scrambled = scrambleToFacelets("R U R' U' F2 L D B' R2 U");
    const slots = ["U", "R", "F", "D", "L", "B"];
    for (const variant of orientationVariants(scrambled)) {
      const relabel: Record<string, string> = {};
      slots.forEach((slot, i) => (relabel[variant[i * 9 + 4]] = slot));
      const canonical = variant
        .split("")
        .map((ch) => relabel[ch])
        .join("");
      expect(validateFacelets(canonical).ok, variant).toBe(true);
    }
  });

  it("для перемешанного состояния ориентации действительно различаются", () => {
    const scrambled = scrambleToFacelets("R U R' U' F2 L D B' R2 U");
    expect(new Set(orientationVariants(scrambled)).size).toBe(24);
  });

  it("двойной поворот эквивалентен одному из набора — группа замкнута", () => {
    const scrambled = scrambleToFacelets("R U F");
    const all = new Set(orientationVariants(scrambled));
    for (let a = 0; a < 24; a++) {
      for (let b = 0; b < 24; b++) {
        const twice = rotateFacelets(rotateFacelets(scrambled, a), b);
        expect(all.has(twice)).toBe(true);
      }
    }
  });
});

// --- сверка скрамбла под произвольным хватом (корень багрепорта) -------------

describe("lenientVerify под поворотом всего кубика", () => {
  const scramble = "R U R' U' F2 L D B' R2 U";
  const expected = scrambleToFacelets(scramble);

  /** Разложить строку на 6 «снимков» так, как их отдал бы ридер. */
  function captures(facelets: string) {
    const grids: Face[][] = [];
    const faceOf: Face[] = [];
    for (let i = 0; i < 6; i++) {
      grids.push(facelets.slice(i * 9, i * 9 + 9).split("") as Face[]);
      faceOf.push(facelets[i * 9 + 4] as Face);
    }
    return { grids, faceOf };
  }

  it("кубик, собранный правильно, но взятый иначе в руки — 0 расхождений", () => {
    for (let k = 0; k < 24; k++) {
      const held = rotateFacelets(expected, k);
      const { grids, faceOf } = captures(held);
      const m = lenientVerify(grids, faceOf, expected);
      expect(m.mismatches, `ориентация ${k}`).toBe(0);
    }
  });

  it("грани, показанные под произвольным углом, тоже дают 0", () => {
    const held = rotateFacelets(expected, 7);
    const { grids, faceOf } = captures(held);
    const spun = grids.map((g, i) => rotateGrid(g, i % 4));
    expect(lenientVerify(spun, faceOf, expected).mismatches).toBe(0);
  });

  it("реально другой скрамбл всё ещё не проходит", () => {
    const other = scrambleToFacelets("L2 D F R' B U2 F' L R2 D'");
    const { grids, faceOf } = captures(other);
    expect(lenientVerify(grids, faceOf, expected).mismatches).toBeGreaterThan(6);
  });
});
