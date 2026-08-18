// Last-layer trainer's slice of the EN dictionary (PLL + OLL). Case ids
// (Aa, Ub, G-perm, OLL1..OLL57) and nicknames (Sune, Antisune, …) are
// international notation and must NOT be translation keys — a case name is
// the same in every language a cuber reads.

import { describe, it, expect } from "vitest";
import { EN } from "../../src/i18n/en";
import { ALL_CASE_IDS } from "../../src/trainer/pll";
import { ALL_OLL_CASE_IDS, OLL_CASES } from "../../src/trainer/oll";

describe("тренажёр последнего слоя — словарь", () => {
  it("покрывает экран целиком", () => {
    for (const key of [
      "Тренажёр последнего слоя",
      "Набор случаев",
      "PLL (перестановка)",
      "OLL (ориентация)",
      "Все 21",
      "Все 57",
      "Только рёбра",
      "Только углы",
      "Соседняя пара",
      "По диагонали",
      "G-перестановки",
      "Смешанные",
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

  it("PLL case id-ы (Aa/Ub/…) не встречаются как ключи словаря", () => {
    for (const id of ALL_CASE_IDS) {
      expect(id in EN, `«${id}» не должен быть ключом словаря`).toBe(false);
    }
  });

  it("OLL case id-ы (OLL1../OLL57) и никнеймы (Sune/…) не встречаются как ключи словаря", () => {
    for (const id of ALL_OLL_CASE_IDS) {
      expect(id in EN, `«${id}» не должен быть ключом словаря`).toBe(false);
    }
    for (const c of OLL_CASES) {
      expect(c.name in EN, `«${c.name}» не должен быть ключом словаря`).toBe(false);
    }
  });
});
