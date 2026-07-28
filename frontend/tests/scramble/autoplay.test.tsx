// @vitest-environment jsdom
//
// Автопрокрутка инструкции скрамбла (по просьбе из живого теста: жать «дальше»
// 25 раз — не работа человека). Проверяем: сама идёт, останавливается на конце,
// ручной шаг перехватывает управление, скорость переключается и запоминается.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import ScrambleWalkthrough, {
  speedById,
  AUTOPLAY_SPEEDS,
} from "../../src/solo/ScrambleWalkthrough";

vi.mock("../../src/scramble/hooks/useTwisty", () => ({
  useTwisty: () => ({
    slotRef: { current: null },
    ready: true,
    error: null,
    showState: vi.fn(),
    animateMove: vi.fn(),
  }),
}));

const MOVES = ["R", "U", "F'"];

// Рабочее хранилище: в этом окружении настоящего localStorage нет, а выбор
// скорости обязан переживать перемонтирование.
function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage);
}

beforeEach(() => {
  vi.useFakeTimers();
  stubStorage();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("speedById", () => {
  it("неизвестное значение падает в «обычно», а не ломает экран", () => {
    expect(speedById("рекорд").id).toBe("normal");
    expect(speedById(null).id).toBe("normal");
  });

  it("медленно действительно медленнее быстрого", () => {
    expect(speedById("slow").delayMs).toBeGreaterThan(speedById("fast").delayMs);
  });
});

describe("ScrambleWalkthrough — автопрокрутка", () => {
  it("сама проходит все ходы и останавливается в конце", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Показать самому" }));
    const delay = speedById(null).delayMs;

    act(() => void vi.advanceTimersByTime(delay));
    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();

    act(() => void vi.advanceTimersByTime(delay));
    act(() => void vi.advanceTimersByTime(delay));
    expect(screen.getByText(/Готово: все 3 ходов сделаны/)).toBeTruthy();
    // На конце кнопка автопрокрутки исчезает — дальше идти некуда.
    expect(screen.queryByRole("button", { name: "Пауза" })).toBeNull();
  });

  it("пауза останавливает, а не просто перекрашивает кнопку", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);
    const delay = speedById(null).delayMs;

    fireEvent.click(screen.getByRole("button", { name: "Показать самому" }));
    act(() => void vi.advanceTimersByTime(delay));
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    act(() => void vi.advanceTimersByTime(delay * 5));

    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
  });

  it("ручной шаг перехватывает управление у автопрокрутки", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);
    const delay = speedById(null).delayMs;

    fireEvent.click(screen.getByRole("button", { name: "Показать самому" }));
    fireEvent.click(screen.getByRole("button", { name: "дальше →" }));
    act(() => void vi.advanceTimersByTime(delay * 5));

    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Показать самому" })).toBeTruthy();
  });

  it("скорость переключается и переживает перемонтирование", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);

    fireEvent.change(screen.getByLabelText("Скорость"), { target: { value: "fast" } });
    cleanup();
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);
    expect((screen.getByLabelText("Скорость") as HTMLSelectElement).value).toBe("fast");

    fireEvent.click(screen.getByRole("button", { name: "Показать самому" }));
    act(() => void vi.advanceTimersByTime(speedById("fast").delayMs));
    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
  });

  it("три скорости, у каждой своя задержка", () => {
    const delays = AUTOPLAY_SPEEDS.map((s) => s.delayMs);
    expect(new Set(delays).size).toBe(AUTOPLAY_SPEEDS.length);
  });
});
