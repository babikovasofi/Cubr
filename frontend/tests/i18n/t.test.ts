// Механизм перевода. Ключ — сама русская строка (см. src/i18n/t.ts), поэтому
// главное свойство: на `ru` возвращается ключ как есть, а на `en` без перевода
// человек видит русский текст, а не идентификатор.
//
// Словарь `en` — ленивый чанк (см. заголовок t.ts): translate("en", …) до его
// загрузки отдаёт русский ключ, как и без перевода вовсе. Тесты, которым
// нужен уже переведённый результат, сперва грузят словарь через loadEnDict().

import { describe, it, expect, beforeAll } from "vitest";
import { translate, loadEnDict } from "../../src/i18n/t";
import { EN } from "../../src/i18n/en";

describe("translate", () => {
  it("на русском возвращает сам ключ", () => {
    expect(translate("ru", "Правила")).toBe("Правила");
    expect(translate("ru", "Строка, которой нет ни в одном словаре")).toBe(
      "Строка, которой нет ни в одном словаре",
    );
  });

  it("на английском без загруженного словаря остаётся русский текст — не белый экран, не ключ", () => {
    const untranslated = "Строка, которой нет ни в одном словаре";
    expect(translate("en", untranslated)).toBe(untranslated);
  });

  it("подставляет параметры на русском", () => {
    expect(translate("ru", "Кубки: {n}", { n: 3 })).toBe("Кубки: 3");
  });

  it("неизвестный параметр оставляет плейсхолдер, а не рушит строку", () => {
    expect(translate("ru", "Кубки: {n}", { other: 1 })).toBe("Кубки: {n}");
  });

  describe("после загрузки словаря en", () => {
    beforeAll(async () => {
      await loadEnDict();
    });

    it("отдаёт перевод", () => {
      expect(translate("en", "Правила")).toBe("Rules");
      expect(translate("en", "Войти")).toBe("Log in");
    });

    it("подставляет параметры", () => {
      expect(translate("en", "Кубки: {n}", { n: 3 })).toBe("Cups: 3");
    });

    it("непереведённый ключ остаётся русским и после загрузки словаря", () => {
      const untranslated = "Строка, которой нет ни в одном словаре";
      expect(translate("en", untranslated)).toBe(untranslated);
    });
  });

  it("словарь не содержит пустых переводов", () => {
    const empty = Object.entries(EN).filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("переводы с подстановкой сохраняют плейсхолдеры ключа", () => {
    for (const [key, value] of Object.entries(EN)) {
      const placeholders = (key.match(/\{(\w+)\}/g) ?? []).sort();
      const translated = (value.match(/\{(\w+)\}/g) ?? []).sort();
      expect(translated, `перевод «${key}» потерял подстановку`).toEqual(placeholders);
    }
  });
});
