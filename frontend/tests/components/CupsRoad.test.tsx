// @vitest-environment jsdom
//
// CupsRoad не хранит собственную таблицу порогов — все числа (floor,
// to_next) идут прямо из user (см. src/components/CupsRoad.tsx). Компонент
// теперь рисует ТОЛЬКО лестницу — большой счётчик кубков и подпись до
// следующего ранга переехали на отдельный экран (см. CupsPage.test.tsx).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CupsRoad from "../../src/components/CupsRoad";
import { useAuthStore } from "../../src/store/authStore";
import type { UserRead } from "../../src/api/auth";

function user(overrides: Partial<UserRead>): UserRead {
  return {
    id: "u-1",
    email: "a@b.com",
    is_active: true,
    is_superuser: false,
    is_verified: true,
    avatar_url: null,
    cups: 0,
    cups_rank: "white",
    cups_floor: 0,
    cups_to_next: 100,
    best_single_ms: null,
    best_ao5_ms: null,
    handle: null,
    method: null,
    cubing_since_year: null,
    onboarded_at: null,
    created_at: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("CupsRoad", () => {
  it("рисует все шесть ступеней и не содержит эмодзи-кубок", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 300 }),
      status: "authed",
    });
    render(<CupsRoad />);

    for (const label of ["Белый", "Жёлтый", "Зелёный", "Синий", "Оранжевый", "Красный"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(/🏆/)).toBeNull();
  });

  it("порог показан только у текущей ступени", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 300 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("ты здесь · от 300")).toBeTruthy();
    // Соседние ступени не выдумывают свой порог.
    expect(screen.queryAllByText(/от /)).toHaveLength(1);
  });

  it("cups=0 → первая ступень текущая, без порога у остальных", () => {
    useAuthStore.setState({
      user: user({ cups: 0, cups_rank: "white", cups_floor: 0, cups_to_next: 100 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("ты здесь · от 0")).toBeTruthy();
  });

  it("cups_to_next === null (red, atMax) → последняя ступень текущая", () => {
    useAuthStore.setState({
      user: user({ cups: 1800, cups_rank: "red", cups_floor: 1500, cups_to_next: null }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("Красный")).toBeTruthy();
    expect(screen.getByText("ты здесь · от 1500")).toBeTruthy();
  });
});
