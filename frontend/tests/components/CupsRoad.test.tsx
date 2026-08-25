// @vitest-environment jsdom
//
// CupsRoad — горизонтальная brawl-дорога: 6 узлов-рубежей, соединённых
// сегментами с перетеканием цвета, и стикер «ты здесь» над позицией игрока.
// Пороги под узлами — из карты RANKS (зеркало backend CUPS_TIERS), только для
// подписи; позиция/прогресс — из user.cups_floor/cups_to_next.

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
  it("рисует все шесть рубежей и не содержит эмодзи-кубок", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 150 }),
      status: "authed",
    });
    render(<CupsRoad />);

    for (const label of ["Белый", "Жёлтый", "Зелёный", "Синий", "Оранжевый", "Красный"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(/🏆/)).toBeNull();
  });

  it("каждый узел подписан своим порогом «от N» (все шесть)", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 150 }),
      status: "authed",
    });
    render(<CupsRoad />);

    for (const floor of ["от 0", "от 100", "от 300", "от 600", "от 1000", "от 1500"]) {
      expect(screen.getByText(floor)).toBeTruthy();
    }
  });

  it("стикер «ты здесь» показывает текущее число кубков", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 150 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("ты здесь · 450")).toBeTruthy();
  });

  it("cups=0 → первый рубеж (Белый) текущий, стикер с нулём", () => {
    useAuthStore.setState({
      user: user({ cups: 0, cups_rank: "white", cups_floor: 0, cups_to_next: 100 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("ты здесь · 0")).toBeTruthy();
    expect(screen.getByText("Белый")).toBeTruthy();
  });

  it("cups_to_next === null (red, atMax) → без падения, стикер на максимуме", () => {
    useAuthStore.setState({
      user: user({ cups: 1800, cups_rank: "red", cups_floor: 1500, cups_to_next: null }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("Красный")).toBeTruthy();
    expect(screen.getByText("ты здесь · 1800")).toBeTruthy();
  });
});
