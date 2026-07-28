// @vitest-environment jsdom
//
// Серия ежедневных сборок (V3). Три состояния, которые пользователь реально
// видит: серии нет / серия закрыта сегодня / серия под угрозой. Плюс правило,
// что упавший запрос серии не ломает страницу.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const { getDailyStreakMock } = vi.hoisted(() => ({ getDailyStreakMock: vi.fn() }));

vi.mock("../../src/api/daily", () => ({
  getDailyStreak: getDailyStreakMock,
}));

import StreakBadge, { streakHeadline, daysWord } from "../../src/daily/StreakBadge";

const BASE = { last_day: "2026-07-28", today: "2026-07-28" };

beforeEach(() => {
  getDailyStreakMock.mockReset();
});
afterEach(cleanup);

describe("streakHeadline", () => {
  it("нет серии и не было — зовёт начать", () => {
    const text = streakHeadline({
      ...BASE,
      current_streak: 0,
      best_streak: 0,
      completed_today: false,
      last_day: null,
    });
    expect(text).toContain("Серии пока нет");
  });

  it("серия прервалась — говорит об этом, а не притворяется", () => {
    const text = streakHeadline({
      ...BASE,
      current_streak: 0,
      best_streak: 7,
      completed_today: false,
    });
    expect(text).toContain("прервалась");
  });

  it("сегодня засчитано", () => {
    const text = streakHeadline({
      ...BASE,
      current_streak: 3,
      best_streak: 5,
      completed_today: true,
    });
    expect(text).toBe("3 дня подряд — сегодня уже засчитано.");
  });

  it("серия под угрозой — сегодня ещё не пройден", () => {
    const text = streakHeadline({
      ...BASE,
      current_streak: 1,
      best_streak: 5,
      completed_today: false,
    });
    expect(text).toContain("Сегодня ещё не пройден");
  });
});

describe("daysWord", () => {
  it.each([
    [1, "день"],
    [2, "дня"],
    [5, "дней"],
    [11, "дней"],
    [21, "день"],
    [22, "дня"],
    [111, "дней"],
  ])("%i → %s", (n, word) => {
    expect(daysWord(n)).toBe(word);
  });
});

describe("StreakBadge", () => {
  it("рисует текущую серию и рекорд", async () => {
    getDailyStreakMock.mockResolvedValue({
      ...BASE,
      current_streak: 4,
      best_streak: 9,
      completed_today: true,
    });

    render(<StreakBadge />);

    await waitFor(() => expect(screen.getByText(/4 дня подряд/)).toBeTruthy());
    expect(screen.getByText(/Рекорд: 9 дней/)).toBeTruthy();
  });

  it("до ответа не рисует ничего (не мигает пустой карточкой)", () => {
    getDailyStreakMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<StreakBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("упавший запрос серии молча исчезает, а не ломает страницу", async () => {
    getDailyStreakMock.mockRejectedValue(new Error("boom"));
    const { container } = render(<StreakBadge />);
    await waitFor(() => expect(getDailyStreakMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
