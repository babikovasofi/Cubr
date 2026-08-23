// Подсказка «какую грань показывать». Живая жалоба 2026-08-24: «Снять грань
// 3/6» не говорит, какую именно грань нести к рамке.

import { describe, expect, it } from "vitest";

import { facePrompt, SOLO_FACE_ORDER } from "../../src/solo/facePrompts";
import { EN } from "../../src/i18n/en";

describe("facePrompt", () => {
  it("ведёт по шести граням в порядке URFDLB", () => {
    expect(SOLO_FACE_ORDER).toEqual(["U", "R", "F", "D", "L", "B"]);
    expect(facePrompt(0, true)).toContain("БЕЛУЮ");
    expect(facePrompt(1, true)).toContain("КРАСНУЮ");
    expect(facePrompt(2, true)).toContain("ЗЕЛЁНУЮ");
    expect(facePrompt(3, true)).toContain("ЖЁЛТУЮ");
    expect(facePrompt(4, true)).toContain("ОРАНЖЕВУЮ");
    expect(facePrompt(5, true)).toContain("СИНЮЮ");
  });

  it("на скрамблированном кубике называет ЦЕНТР, а не грань", () => {
    // Одноцветной грани на скрамбле не существует: «покажи белую грань»
    // отправляет искать то, чего нет.
    for (let step = 0; step < 6; step++) {
      expect(facePrompt(step, false)).toContain("центром");
      expect(facePrompt(step, true)).not.toContain("центром");
    }
  });

  it("за пределами шести шагов молчит, а не выдумывает седьмую грань", () => {
    expect(facePrompt(6, true)).toBeNull();
    expect(facePrompt(-1, true)).toBeNull();
    expect(facePrompt(1.5, false)).toBeNull();
  });

  it("каждая подсказка переведена — иначе английский интерфейс станет русским", () => {
    for (let step = 0; step < 6; step++) {
      for (const solved of [true, false]) {
        const key = facePrompt(step, solved)!;
        expect(EN[key], key).toBeTruthy();
      }
    }
  });
});
