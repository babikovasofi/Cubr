// @vitest-environment jsdom
//
// Автопрокрутка инструкции скрамбла (по просьбе из живого теста: жать «дальше»
// 25 раз — не работа человека). Проверяем: сама идёт, останавливается на конце,
// ручной шаг перехватывает управление, скорость переключается и запоминается.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import ScrambleWalkthrough, {
  AUTOPLAY_DELAYS_MS,
  DEFAULT_SPEED_STEP,
  clampSpeedStep,
  speedLabel,
  speedStepFromStorage,
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

describe("шкала скорости", () => {
  it("мусор в хранилище не ломает экран — берётся значение по умолчанию", () => {
    expect(speedStepFromStorage("рекорд")).toBe(DEFAULT_SPEED_STEP);
    expect(speedStepFromStorage(null)).toBe(DEFAULT_SPEED_STEP);
    expect(speedStepFromStorage("99")).toBe(AUTOPLAY_DELAYS_MS.length - 1);
    expect(speedStepFromStorage("-5")).toBe(0);
  });

  it("шкала идёт от медленного к быстрому без повторов", () => {
    const delays = [...AUTOPLAY_DELAYS_MS];
    expect(new Set(delays).size).toBe(delays.length);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeLessThan(delays[i - 1]);
  });

  it("подпись показывает секунды на ход", () => {
    expect(speedLabel(DEFAULT_SPEED_STEP)).toBe("1.4 с/ход");
    expect(clampSpeedStep(1.4)).toBe(1);
  });
});

describe("ScrambleWalkthrough — автопрокрутка", () => {
  it("сама проходит все ходы и останавливается в конце", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Крутить за меня" }));
    const delay = AUTOPLAY_DELAYS_MS[DEFAULT_SPEED_STEP];

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
    const delay = AUTOPLAY_DELAYS_MS[DEFAULT_SPEED_STEP];

    fireEvent.click(screen.getByRole("button", { name: "Крутить за меня" }));
    act(() => void vi.advanceTimersByTime(delay));
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    act(() => void vi.advanceTimersByTime(delay * 5));

    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
  });

  it("ручной шаг перехватывает управление у автопрокрутки", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);
    const delay = AUTOPLAY_DELAYS_MS[DEFAULT_SPEED_STEP];

    fireEvent.click(screen.getByRole("button", { name: "Крутить за меня" }));
    fireEvent.click(screen.getByRole("button", { name: "дальше →" }));
    act(() => void vi.advanceTimersByTime(delay * 5));

    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Крутить за меня" })).toBeTruthy();
  });

  it("ползунок скорости меняет темп и переживает перемонтирование", () => {
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);

    // Ползунок идёт «медленнее → быстрее», крайнее правое = самый быстрый шаг.
    const fastest = AUTOPLAY_DELAYS_MS.length - 1;
    fireEvent.change(screen.getByLabelText("Скорость"), { target: { value: String(fastest) } });
    expect(screen.getByText(speedLabel(fastest))).toBeTruthy();

    cleanup();
    render(<ScrambleWalkthrough moves={MOVES} onDone={() => {}} />);
    expect(screen.getByText(speedLabel(fastest))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Крутить за меня" }));
    act(() => void vi.advanceTimersByTime(AUTOPLAY_DELAYS_MS[fastest]));
    expect(screen.getByText(/Ход 1 из 3/)).toBeTruthy();
  });
});
