// Детекция «основной ввод — палец» (Этап 6, R8). Матрица важна тем, что ошибка
// в любую сторону дорогая: ложный минус = сломанный ритуал на телефоне, ложный
// плюс = заблокированный десктопный пользователь.

import { describe, it, expect } from "vitest";
import { HANDHELD_QUERY, isHandheldDevice } from "../../src/lib/device";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120";

function media(matches: boolean) {
  return (query: string) => {
    expect(query).toBe(HANDHELD_QUERY);
    return matches;
  };
}

describe("isHandheldDevice", () => {
  it("телефон: hover:none + pointer:coarse → гейт", () => {
    expect(isHandheldDevice({ matchesMedia: media(true), userAgent: IPHONE_UA })).toBe(true);
  });

  it("десктоп с мышью → не гейт", () => {
    expect(isHandheldDevice({ matchesMedia: media(false), userAgent: MAC_UA })).toBe(false);
  });

  it("ноутбук с тачскрином не гейтится: media-запрос ложный несмотря на тач", () => {
    // hover: hover — мышь есть, значит `(hover:none) and (pointer:coarse)` = false.
    expect(
      isHandheldDevice({ matchesMedia: media(false), maxTouchPoints: 10, userAgent: MAC_UA }),
    ).toBe(false);
  });

  it("media-запрос авторитетнее UA: iPadOS с десктопным UA всё равно гейтится", () => {
    expect(
      isHandheldDevice({ matchesMedia: media(true), maxTouchPoints: 5, userAgent: MAC_UA }),
    ).toBe(true);
  });

  it("без matchMedia: мобильный UA + тач → гейт", () => {
    expect(isHandheldDevice({ maxTouchPoints: 5, userAgent: IPHONE_UA })).toBe(true);
  });

  it("без matchMedia: десктопный UA → не гейт", () => {
    expect(isHandheldDevice({ maxTouchPoints: 0, userAgent: MAC_UA })).toBe(false);
  });

  it("без matchMedia: мобильный UA, но нулевой тач → не гейт", () => {
    expect(isHandheldDevice({ maxTouchPoints: 0, userAgent: IPHONE_UA })).toBe(false);
  });

  it("сломанный matchMedia не гейтит вслепую — падаем в UA-фолбэк", () => {
    const throwing = () => {
      throw new Error("no matchMedia");
    };
    expect(isHandheldDevice({ matchesMedia: throwing, userAgent: MAC_UA })).toBe(false);
    expect(
      isHandheldDevice({ matchesMedia: throwing, maxTouchPoints: 5, userAgent: IPHONE_UA }),
    ).toBe(true);
  });

  it("пустой probe (SSR/node) → не гейт", () => {
    expect(isHandheldDevice({})).toBe(false);
  });
});
