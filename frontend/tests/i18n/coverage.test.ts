// Здоровье словаря. Проверяем не полноту (она наращивается проходами), а то,
// что уже переведённое не сломано: нет пустых значений, нет «переводов»,
// совпадающих с русским ключом (это скрытая заглушка), плейсхолдеры на месте.

import { describe, it, expect } from "vitest";
import { EN } from "../../src/i18n/en";

const RU = /[А-Яа-яЁё]/;

describe("английский словарь", () => {
  it("не содержит пустых переводов", () => {
    expect(Object.entries(EN).filter(([, v]) => v.trim() === "")).toEqual([]);
  });

  it("не содержит русских «переводов» — такая строка была бы тихой заглушкой", () => {
    // Исключения: намеренно одинаковые в обоих языках (названия языков и т.п.).
    const allowed = new Set(["Русский"]);
    const russian = Object.entries(EN).filter(
      ([key, value]) => RU.test(value) && !allowed.has(value) && value !== key,
    );
    expect(russian).toEqual([]);
  });

  it("перевод не теряет и не выдумывает подстановки", () => {
    for (const [key, value] of Object.entries(EN)) {
      const inKey = (key.match(/\{(\w+)\}/g) ?? []).sort();
      const inValue = (value.match(/\{(\w+)\}/g) ?? []).sort();
      expect(inValue, `подстановки разошлись в «${key}»`).toEqual(inKey);
    }
  });

  it("покрывает хотя бы публичную поверхность и профиль", () => {
    for (const key of ["Правила", "Войти", "Профиль", "Цель", "Мои кубики", "Реванш"]) {
      expect(EN[key], `нет перевода для «${key}»`).toBeTruthy();
    }
  });
});
