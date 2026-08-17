// PLL trainer's slice of the EN dictionary. Case ids (Aa, Ub, G-perm, ...)
// are international notation and must NOT be translation keys — a case name
// is the same in every language a cuber reads.

import { describe, it, expect } from "vitest";
import { EN } from "../../src/i18n/en";
import { ALL_CASE_IDS } from "../../src/trainer/pll";

describe("тренажёр PLL — словарь", () => {
  it("покрывает экран целиком", () => {
    for (const key of [
      "Тренажёр PLL",
      "Все 21",
      "Только рёбра",
      "Только углы",
      "Соседняя пара",
      "По диагонали",
      "G-перестановки",
      "Хват кубика",
      "Обычный хват",
      "Любой хват",
      "Скрамбл",
      "Следующий случай",
      "Показать ответ",
    ]) {
      expect(EN[key], `нет перевода для «${key}»`).toBeTruthy();
    }
  });

  it("case id-ы (Aa/Ub/…) не встречаются как ключи словаря", () => {
    for (const id of ALL_CASE_IDS) {
      expect(id in EN, `«${id}» не должен быть ключом словаря`).toBe(false);
    }
  });
});
