// Подсказки съёмки называют грань по ЦЕНТРУ. Чтения снимаются со
// скрамблированного кубика — одноцветной грани на нём нет, а центры не двигают
// никакие ходы. Живая жалоба: «так они же перепутаны, нет белой грани».

import { describe, it, expect } from "vitest";
import { CAPTURE_HINTS } from "../../src/accuracy/AccuracyControls";
import { CAPTURE_ORDER } from "../../src/vision/accuracyRun";

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
