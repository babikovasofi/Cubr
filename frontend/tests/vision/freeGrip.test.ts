// Свободная хватка: кубик разрешено вертеть. Живой прогон дал 54/54 «с точностью
// до поворота» при 33% строгих — зрение было идеально, а мерили хватку.
// Проверяем, что послабление даёт свободу поворота и НЕ даёт поблажек цвету.

import { describe, it, expect } from "vitest";
import { scoreFreeGrip } from "../../src/vision/accuracy";
import { rotateGrid } from "../../src/vision/cubeGrid";
import { scrambleToFacelets, type Face, type Facelet } from "../../src/vision/cubeState";

const TRUTH: Facelet = scrambleToFacelets("R U F D' L2 B");

function gridsOf(facelets: Facelet): Face[][] {
  return Array.from({ length: 6 }, (_, f) => facelets.slice(f * 9, f * 9 + 9).split("") as Face[]);
}

describe("scoreFreeGrip", () => {
  it("идеальное чтение — 48 из 48: шесть центров в счёт не идут", () => {
    const out = scoreFreeGrip(gridsOf(TRUTH), TRUTH);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.total).toBe(48);
    expect(out.report.correct).toBe(48);
  });

  it("поворот каждой грани на свой угол ничего не меняет", () => {
    const turned = gridsOf(TRUTH).map((g, i) => rotateGrid(g, i % 4));
    const out = scoreFreeGrip(turned, TRUTH);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.correct).toBe(48);
  });

  it("порядок показа граней свободен — опознаём по центру", () => {
    const shuffled = [3, 5, 0, 2, 4, 1].map((i) => gridsOf(TRUTH)[i]);
    const out = scoreFreeGrip(shuffled, TRUTH);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.correct).toBe(48);
    expect(out.faceOf).toEqual(["D", "B", "U", "F", "L", "R"]);
  });

  // Главное: послабление касается ПОВОРОТА, а не цвета. Иначе гейт нечем провалить.
  it("ошибка цвета остаётся ошибкой", () => {
    const grids = gridsOf(TRUTH);
    // Портим не-центральную ячейку в цвет, которого на этой грани не хватает.
    const face = grids[0];
    const victim = face.findIndex((c, j) => j !== 4 && c !== face[4]);
    const wrong = (["U", "R", "F", "D", "L", "B"] as Face[]).find((c) => !face.includes(c));
    if (wrong) face[victim] = wrong;
    const out = scoreFreeGrip(grids, TRUTH);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.correct).toBe(47);
    expect(out.report.stickers.filter((s) => !s.correct)).toHaveLength(1);
  });

  it("центр, прочитанный неверно, ломает опознание граней, а не прощается", () => {
    const grids = gridsOf(TRUTH);
    grids[1][4] = grids[0][4]; // два захвата с одним центром
    const out = scoreFreeGrip(grids, TRUTH);
    expect(out.kind).toBe("assign-conflict");
  });

  it("готовое выравнивание перебивает центр, прочитанный неверно", () => {
    // Ровно живой случай: центр одной съёмки классифицировался тем же цветом,
    // что и у другой. Раскладка шести съёмок по шести цветам (по СЫРЫМ центрам,
    // в продукте — assignFacesByCenter) знает, кто есть кто, и чтение считается.
    const grids = gridsOf(TRUTH);
    grids[1][4] = grids[0][4];
    expect(scoreFreeGrip(grids, TRUTH).kind).toBe("assign-conflict");

    const out = scoreFreeGrip(grids, TRUTH, undefined, ["U", "R", "F", "D", "L", "B"] as Face[]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    // Испорчен ровно один центр, а центры в счёт не идут — все 48 верны.
    expect(out.report.correct).toBe(48);
    expect(out.faceOf).toEqual(["U", "R", "F", "D", "L", "B"]);
  });

  it("выравнивание не той длины игнорируется — падаем обратно на центры", () => {
    const grids = gridsOf(TRUTH);
    const out = scoreFreeGrip(grids, TRUTH, undefined, ["U", "R"] as Face[]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.faceOf).toEqual(["U", "R", "F", "D", "L", "B"]);
  });

  // Цена послабления, записанная тестом: перестановка ВНУТРИ грани невидима.
  // Это ошибка геометрии, а не цвета; её ловит строгая хватка.
  it("перестановка двух наклеек внутри грани не видна — цена режима", () => {
    const grids = gridsOf(TRUTH);
    const face = grids[2];
    const a = face.findIndex((c, j) => j !== 4 && c !== face[0]);
    if (a > 0) {
      const tmp = face[0];
      face[0] = face[a];
      face[a] = tmp;
    }
    const out = scoreFreeGrip(grids, TRUTH);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.report.correct).toBe(48);
  });
});
