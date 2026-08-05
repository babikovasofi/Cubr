import { describe, it, expect } from "vitest";

import { scorePictureGrip } from "../../src/vision/accuracy";
import { pinRotationsByPhysics, rotateGrid } from "../../src/vision/cubeGrid";
import {
  CORNER_FACELETS,
  EDGE_FACELETS,
  countPhysicsViolations,
} from "../../src/vision/cubePhysics";
import {
  SOLVED,
  randomScramble,
  scrambleToFacelets,
  type Face,
  type Facelet,
} from "../../src/vision/cubeState";

const FACES: Face[] = ["U", "R", "F", "D", "L", "B"];

/** Шесть граней состояния как сетки 3×3 в порядке URFDLB. */
function gridsOf(state: Facelet): Face[][] {
  return FACES.map((_, i) => state.slice(i * 9, i * 9 + 9).split("") as Face[]);
}

describe("физика кубика: таблицы углов и рёбер", () => {
  // Если индексы наклеек вбиты неверно, всё остальное считает мусор. Замок:
  // ЛЮБОЕ настоящее состояние обязано давать ноль нарушений.
  it("собранный кубик не нарушает физику", () => {
    expect(countPhysicsViolations(SOLVED).total).toBe(0);
  });

  it("сорок случайных скрамблов не нарушают физику", () => {
    for (let i = 0; i < 40; i++) {
      const state = scrambleToFacelets(randomScramble(25));
      const v = countPhysicsViolations(state);
      expect(v.total, `скрамбл ${i}: ${JSON.stringify(v)}`).toBe(0);
    }
  });

  it("таблицы покрывают все 48 не-центральных наклеек ровно по разу", () => {
    const seen = new Set<number>();
    for (const c of CORNER_FACELETS) for (const i of c) seen.add(i);
    for (const e of EDGE_FACELETS) for (const i of e) seen.add(i);
    expect(seen.size).toBe(48);
    for (const centre of [4, 13, 22, 31, 40, 49]) expect(seen.has(centre)).toBe(false);
  });

  it("подменённая наклейка физику нарушает", () => {
    // U-наклейка угла URF заменена на противоположный цвет: угол получает две
    // наклейки одной оси, чего у настоящего кубика не бывает.
    const broken = (SOLVED.slice(0, 8) + "D" + SOLVED.slice(9)) as Facelet;
    expect(countPhysicsViolations(broken).total).toBeGreaterThan(0);
  });
});

describe("pinRotationsByPhysics", () => {
  it("восстанавливает повороты, которыми грани были развёрнуты", () => {
    const state = scrambleToFacelets("R U R' U' F2 L D L' B2");
    const turns = [0, 1, 2, 3, 1, 2];
    const spun = gridsOf(state).map((g, i) => rotateGrid(g, turns[i]));

    const pin = pinRotationsByPhysics(spun, FACES);
    expect(pin.ok).toBe(true);
    expect(pin.violations).toBe(0);
    expect(pin.tied).toBe(1);
    // Поворот назад: rotateGrid(g, k) отменяется поворотом на 4-k.
    expect(pin.rotations).toEqual(turns.map((k) => (4 - k) % 4));
    expect(pin.facelets).toBe(state);
  });

  it("НЕ смотрит на ожидаемый скрамбл — сигнатура его просто не принимает", () => {
    // Замок против подгонки под ответ: если бы функция когда-нибудь начала
    // принимать эталон, этот тест пришлось бы править руками — и это заметят.
    expect(pinRotationsByPhysics.length).toBe(2);
  });

  it("собранный кубик даёт неоднозначный поворот — и говорит об этом", () => {
    // У собранного кубика грань одноцветная, поворот принципиально не определён.
    const pin = pinRotationsByPhysics(gridsOf(SOLVED), FACES);
    expect(pin.ok).toBe(true);
    expect(pin.violations).toBe(0);
    expect(pin.tied).toBeGreaterThan(1);
  });

  it("отказывает, когда шесть съёмок дали не шесть разных центров", () => {
    const g = gridsOf(scrambleToFacelets("R U R'"));
    const pin = pinRotationsByPhysics(g, ["U", "U", "F", "D", "L", "B"] as Face[]);
    expect(pin.ok).toBe(false);
    expect(pin.reason).toMatch(/центрам/);
  });
});

describe("scorePictureGrip", () => {
  const scramble = "R U R' U' F2 L D L' B2";
  const truth = scrambleToFacelets(scramble);

  it("идеальное чтение под произвольными поворотами даёт 48/48", () => {
    const spun = gridsOf(truth).map((g, i) => rotateGrid(g, [2, 3, 1, 0, 3, 1][i]));
    const res = scorePictureGrip(spun, truth, FACES);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.report.total).toBe(48);
    expect(res.report.correct).toBe(48);
    expect(res.violations).toBe(0);
  });

  it("центры в счёт не идут", () => {
    const res = scorePictureGrip(gridsOf(truth), truth, FACES);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.report.stickers.every((s) => s.cellInFace !== 4)).toBe(true);
  });

  it("ЛОВИТ перестановку двух наклеек внутри грани — то, что слепа свободная хватка", () => {
    // Меняем местами две не-центральные наклейки грани U. Мультимножество цветов
    // грани не меняется вовсе, поэтому свободная хватка поставила бы 48/48.
    const grids = gridsOf(truth);
    const u = grids[0];
    let a = -1;
    let b = -1;
    for (let i = 0; i < 9 && b < 0; i++) {
      if (i === 4) continue;
      for (let j = i + 1; j < 9; j++) {
        if (j === 4) continue;
        if (u[i] !== u[j]) {
          a = i;
          b = j;
          break;
        }
      }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    [u[a], u[b]] = [u[b], u[a]];

    const res = scorePictureGrip(grids, truth, FACES);
    // Перестановка ломает физику углов/рёбер, поэтому исход — либо честный счёт
    // с промахами, либо честная неопределённость поворота. Чего быть НЕ должно —
    // это 48/48: именно им свободная хватка и врёт.
    if (res.kind === "ok") {
      expect(res.report.correct).toBeLessThan(48);
    } else {
      expect(res.kind).toBe("rotation-ambiguous");
    }
  });

  it("одна ошибка цвета не отправляет чтение в брак — оно оценивается", () => {
    const grids = gridsOf(truth);
    // Портим одну не-центральную ячейку на цвет, которого там нет.
    const wrong: Face = grids[1][0] === "U" ? "D" : "U";
    grids[1][0] = wrong;

    const res = scorePictureGrip(grids, truth, FACES);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.report.correct).toBe(47);
    expect(res.violations).toBeGreaterThan(0);
  });

  it("отказывается считать, когда физика поворот не определила", () => {
    const res = scorePictureGrip(gridsOf(SOLVED), SOLVED, FACES);
    expect(res.kind).toBe("rotation-ambiguous");
  });

  it("бракует неполный набор граней", () => {
    const res = scorePictureGrip(gridsOf(truth).slice(0, 5), truth, FACES);
    expect(res.kind).toBe("assign-conflict");
  });
});
