// @vitest-environment jsdom
//
// Живая грань в герое лендинга. Проверяем ровно две вещи, которые легко сломать:
// цикл действительно идёт (грань мешается и сходится в один цвет) и
// prefers-reduced-motion выключает таймеры совсем.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import HeroStickers from "../../src/components/HeroStickers";

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function backgrounds(): string[] {
  return screen.getAllByTestId("hero-sticker").map((el) => el.style.background);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HeroStickers", () => {
  it("рисует 9 наклеек", () => {
    setReducedMotion(true);
    render(<HeroStickers />);

    expect(screen.getAllByTestId("hero-sticker")).toHaveLength(9);
    expect(backgrounds().every((bg) => bg.length > 0)).toBe(true);
  });

  it("мешает грань и доводит её до одного цвета", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    render(<HeroStickers />);

    const before = backgrounds();

    // Первый тик — грань уже не та, что была на монтировании.
    act(() => {
      vi.advanceTimersByTime(700 + 430);
    });
    expect(backgrounds()).not.toEqual(before);

    // К концу цикла (7 тиков «мешаем») грань сходится в один цвет.
    act(() => {
      vi.advanceTimersByTime(430 * 7);
    });
    const solved = backgrounds();
    expect(new Set(solved).size).toBe(1);
  });

  it("prefers-reduced-motion — таймеры не заводятся, кадр статичный", () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    render(<HeroStickers />);

    const before = backgrounds();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(backgrounds()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
