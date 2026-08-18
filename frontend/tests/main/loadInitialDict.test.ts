// Решение против мигания (см. src/i18n/loadInitialDict.ts): сохранённый
// английский обязан ждать словарь ДО первого рендера, иначе первый экран
// мигнёт русским.
//
// Порядок тестов важен: словарь — модульный синглтон на файл, поэтому сперва
// проверяем состояние «ещё не загружен» (ru), потом переходим к «загружен» (en).

import { describe, it, expect, vi, afterEach } from "vitest";
import { loadInitialDict } from "../../src/i18n/loadInitialDict";
import { isEnDictReady } from "../../src/i18n/t";

const realStorage = globalThis.localStorage;

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", realStorage);
  vi.unstubAllGlobals();
});

describe("loadInitialDict", () => {
  it("русский — исходный дефолт, словарь для него не грузится", async () => {
    stubStorage({ cubr_lang: "ru" });

    await loadInitialDict();

    expect(isEnDictReady()).toBe(false);
  });

  it("сохранённый английский поднимается уже переведённым — словарь готов до рендера", async () => {
    stubStorage({ cubr_lang: "en" });

    await loadInitialDict();

    expect(isEnDictReady()).toBe(true);
  });
});
