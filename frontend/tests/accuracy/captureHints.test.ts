// Подсказки съёмки называют грань по ЦЕНТРУ. Чтения снимаются со
// скрамблированного кубика — одноцветной грани на нём нет, а центры не двигают
// никакие ходы. Живая жалоба: «так они же перепутаны, нет белой грани».

import { describe, it, expect } from "vitest";
import { CAPTURE_HINTS } from "../../src/accuracy/AccuracyControls";
import { CAPTURE_ORDER } from "../../src/vision/accuracyRun";
import { config } from "../../src/vision/config";
import { dimWhiteWarningRu } from "../../src/vision/guide";

describe("подсказки съёмки", () => {
  it("идут ровно в порядке захвата URFDLB", () => {
    expect(CAPTURE_HINTS.map((h) => h.face)).toEqual([...CAPTURE_ORDER]);
  });

  it("называют грань по центру, а не по цвету всей грани", () => {
    for (const hint of CAPTURE_HINTS) {
      expect(hint.ru).toMatch(/центр/i);
      // «БЕЛУЮ грань» и подобное — текст калибровки собранного кубика; на
      // скрамбле он отправляет искать несуществующее.
      expect(hint.ru).not.toMatch(/[ЮУ]Ю грань/);
    }
  });
});

// Цвет → грань стандартной схемы (белый–жёлтый, красный–оранжевый,
// зелёный–синий напротив). Требование схемы записано в протоколе гейта.
const FACE_OF_COLOUR: [RegExp, string][] = [
  [/бел/, "U"],
  [/красн/, "R"],
  [/зелён/, "F"],
  [/жёлт/, "D"],
  [/оранж/, "L"],
  [/син/, "B"],
];

const OPPOSITE: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

/**
 * Какой центр оказывается СВЕРХУ, когда показываешь в камеру данную грань.
 *
 * Не из прозы и не из «как держали в прошлый раз», а из раскладки URFDLB, по
 * которой считается эталон: грань U пишется как видна сверху, и её верхний ряд
 * граничит с B; грань D — как видна снизу, её верхний ряд граничит с F; у
 * четырёх боковых сверху всегда U. Подсказка обязана совпадать с этим, иначе
 * человек развернёт грань правильно по своему разумению и неправильно по
 * эталону — а строгая хватка считает именно позиции.
 */
const ABOVE: Record<string, string> = { U: "B", R: "U", F: "U", D: "F", L: "U", B: "U" };

function faceOf(text: string): string | null {
  for (const [re, face] of FACE_OF_COLOUR) if (re.test(text)) return face;
  return null;
}

describe("подсказки съёмки: геометрия против модели кубика", () => {
  for (const hint of CAPTURE_HINTS) {
    it(`грань ${hint.face}: названы та грань, тот верх и тот низ`, () => {
      const text = hint.ru.toLowerCase();
      const [cameraPart, rest = ""] = text.split("наверху");
      const [topPart, bottomPart] = rest.split("внизу");

      expect(faceOf(cameraPart)).toBe(hint.face);
      expect(faceOf(topPart)).toBe(ABOVE[hint.face]);

      // Низ называется не всегда, но если назван — он противоположен верху.
      // Живая находка: у жёлтой грани стоял белый, а белый напротив жёлтого и
      // при жёлтом в камере лежит СЗАДИ. Такую строку человек выполнить не
      // может вовсе, и на замере это превращается в развёрнутую грань.
      if (bottomPart !== undefined) {
        expect(faceOf(bottomPart)).toBe(OPPOSITE[ABOVE[hint.face]]);
      }
    });
  }

  it("ни одна подсказка не ставит наверх грань, противоположную показанной", () => {
    for (const hint of CAPTURE_HINTS) {
      expect(ABOVE[hint.face]).not.toBe(OPPOSITE[hint.face]);
      expect(ABOVE[hint.face]).not.toBe(hint.face);
    }
  });
});

describe("предупреждение о тусклом белом", () => {
  it("называет обе величины и говорит, что делать", () => {
    const msg = dimWhiteWarningRu(67, config.CALIB_MIN_WHITE_L);
    expect(msg).toContain("67");
    expect(msg).toContain(String(config.CALIB_MIN_WHITE_L));
    // Лечение — свет и дистанция, а не «попробуй ещё раз».
    expect(msg).toMatch(/света|ближе/);
  });

  it("порог живёт выше живого отказа (L=67) и ниже здорового белого", () => {
    expect(config.CALIB_MIN_WHITE_L).toBeGreaterThan(67);
    expect(config.CALIB_MIN_WHITE_L).toBeLessThan(85);
  });
});
