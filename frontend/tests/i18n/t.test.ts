// Механизм перевода. Ключ — сама русская строка (см. src/i18n/t.ts), поэтому
// главное свойство: на `ru` возвращается ключ как есть, а на `en` без перевода
// человек видит русский текст, а не идентификатор.

import { describe, it, expect } from "vitest";
import { translate } from "../../src/i18n/t";
import { EN } from "../../src/i18n/en";

describe("translate", () => {
  it("на русском возвращает сам ключ", () => {
    expect(translate("ru", "Правила")).toBe("Правила");
    expect(translate("ru", "Строка, которой нет ни в одном словаре")).toBe(
      "Строка, которой нет ни в одном словаре",
    );
  });

  it("на английском отдаёт перевод", () => {
    expect(translate("en", "Правила")).toBe("Rules");
    expect(translate("en", "Войти")).toBe("Log in");
  });

  it("без перевода остаётся русский текст, а не ключ-идентификатор", () => {
    const untranslated = "Строка, которой нет ни в одном словаре";
    expect(translate("en", untranslated)).toBe(untranslated);
  });

  it("подставляет параметры в обоих языках", () => {
    expect(translate("ru", "Кубки: {n}", { n: 3 })).toBe("Кубки: 3");
    expect(translate("en", "Кубки: {n}", { n: 3 })).toBe("Cups: 3");
  });

  it("неизвестный параметр оставляет плейсхолдер, а не рушит строку", () => {
    expect(translate("ru", "Кубки: {n}", { other: 1 })).toBe("Кубки: {n}");
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
