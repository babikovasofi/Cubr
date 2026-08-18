// Русское склонение по числу. Форма выбирается ФРАЗОЙ целиком (она же ключ
// перевода), поэтому тест держит две вещи: выбор формы и то, что три русские
// формы честно схлопываются в две английские через словарь.

import { describe, it, expect } from "vitest";
import { pluralFormRu, pluralRu } from "../../src/i18n/plural";
import { translate, loadEnDict } from "../../src/i18n/t";

const DAYS = ["{n} день", "{n} дня", "{n} дней"] as const;

describe("pluralFormRu", () => {
  it.each([
    [1, 0],
    [2, 1],
    [4, 1],
    [5, 2],
    [11, 2],
    [12, 2],
    [14, 2],
    [21, 0],
    [22, 1],
    [25, 2],
    [111, 2],
    [101, 0],
    [0, 2],
  ])("%i → форма %i", (n, form) => {
    expect(pluralFormRu(n)).toBe(form);
  });
});

describe("pluralRu", () => {
  it("возвращает фразу-ключ, а не слово", () => {
    expect(pluralRu(1, DAYS)).toBe("{n} день");
    expect(pluralRu(3, DAYS)).toBe("{n} дня");
    expect(pluralRu(9, DAYS)).toBe("{n} дней");
  });

  it("вместе с translate даёт готовую строку на обоих языках", async () => {
    // Словарь en — ленивый чанк (см. src/i18n/t.ts); догружаем его явно,
    // иначе translate("en", …) отдаст непереведённый русский ключ.
    await loadEnDict();

    const dnf = [
      "{n} участник не финишировал",
      "{n} участника не финишировали",
      "{n} участников не финишировали",
    ] as const;

    expect(translate("ru", pluralRu(1, dnf), { n: 1 })).toBe("1 участник не финишировал");
    expect(translate("ru", pluralRu(3, dnf), { n: 3 })).toBe("3 участника не финишировали");
    expect(translate("en", pluralRu(1, dnf), { n: 1 })).toBe("1 participant did not finish");
    expect(translate("en", pluralRu(3, dnf), { n: 3 })).toBe("3 participants did not finish");
    expect(translate("en", pluralRu(7, dnf), { n: 7 })).toBe("7 participants did not finish");
  });
});
