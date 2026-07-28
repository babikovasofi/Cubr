// @vitest-environment jsdom
//
// Выбор языка. Русский — исходный язык продукта и дефолт; автоподбор работает
// только там, где выбор есть куда записать (иначе каждый заход угадывал бы заново).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initialLang, isLang, useLangStore } from "../../src/store/langStore";

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
  return data;
}

function stubNavigatorLanguages(languages: string[]) {
  vi.stubGlobal("navigator", { ...navigator, languages, language: languages[0] });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", realStorage);
  vi.unstubAllGlobals();
});

describe("isLang", () => {
  it("принимает только известные языки", () => {
    expect(isLang("ru")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("de")).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});

describe("initialLang", () => {
  it("сохранённый выбор сильнее языка браузера", () => {
    stubStorage({ cubr_lang: "ru" });
    stubNavigatorLanguages(["en-US"]);
    expect(initialLang()).toBe("ru");
  });

  it("английский браузер без сохранённого выбора получает английский", () => {
    stubStorage();
    stubNavigatorLanguages(["en-GB", "ru-RU"]);
    expect(initialLang()).toBe("en");
  });

  it("любой другой язык браузера — русский", () => {
    stubStorage();
    stubNavigatorLanguages(["de-DE"]);
    expect(initialLang()).toBe("ru");
  });

  it("испорченное значение в хранилище игнорируется", () => {
    stubStorage({ cubr_lang: "klingon" });
    stubNavigatorLanguages(["de-DE"]);
    expect(initialLang()).toBe("ru");
  });

  it("без рабочего хранилища автоподбор не срабатывает: дефолт ru", () => {
    vi.stubGlobal("localStorage", undefined);
    stubNavigatorLanguages(["en-US"]);
    expect(initialLang()).toBe("ru");
  });
});

describe("setLang", () => {
  it("пишет выбор в хранилище и в <html lang>", () => {
    const data = stubStorage();
    useLangStore.getState().setLang("en");

    expect(data.get("cubr_lang")).toBe("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");

    useLangStore.getState().setLang("ru");
    expect(document.documentElement.getAttribute("lang")).toBe("ru");
  });
});
