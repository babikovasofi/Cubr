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

import StreakBadge, { streakHeadline } from "../../src/daily/StreakBadge";
import { translate, loadEnDict } from "../../src/i18n/t";

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

describe("streakHeadline · склонение и перевод", () => {
  const enT = (key: string, params?: Record<string, string | number>) =>
    translate("en", key, params);

  it.each([
    [1, "1 день подряд — сегодня уже засчитано."],
    [2, "2 дня подряд — сегодня уже засчитано."],
    [5, "5 дней подряд — сегодня уже засчитано."],
    [11, "11 дней подряд — сегодня уже засчитано."],
    [21, "21 день подряд — сегодня уже засчитано."],
    [111, "111 дней подряд — сегодня уже засчитано."],
  ])("%i дней по-русски", (n, expected) => {
    expect(
      streakHeadline({ ...BASE, current_streak: n, best_streak: n, completed_today: true }),
    ).toBe(expected);
  });

  it("английский берёт форму единственного числа только для одного дня", async () => {
    // en — ленивый чанк (см. src/i18n/t.ts); догружаем явно перед переводом.
    await loadEnDict();
    const one = streakHeadline(
      { ...BASE, current_streak: 1, best_streak: 1, completed_today: true },
      enT,
    );
    const many = streakHeadline(
      { ...BASE, current_streak: 3, best_streak: 3, completed_today: true },
      enT,
    );
    expect(one).toBe("1 day in a row — today is already counted.");
    expect(many).toBe("3 days in a row — today is already counted.");
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
