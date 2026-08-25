// @vitest-environment jsdom
//
// Экран /cups: шапка (число + текущий ранг), листаемая дорога (CupsRoad,
// покрыта отдельно) и полоса прогресса внутри текущего ранга. Награды/бейджи
// не рисуются (owner отложил).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CupsPage from "../../src/pages/CupsPage";
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

describe("CupsPage", () => {
  it("середина ранга: число, текущий ранг и остаток до следующего", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 150 }),
      status: "authed",
    });
    render(<CupsPage />);

    expect(screen.getByText("450")).toBeTruthy();
    // Прогресс внутри ранга: до следующего рубежа и остаток.
    expect(screen.getByText("До ранга Синий")).toBeTruthy();
    expect(screen.getByText("осталось 150")).toBeTruthy();
    expect(screen.queryByText(/🏆/)).toBeNull();
  });

  it("cups_to_next === null (red, atMax) → «Все рубежи взяты.» вместо остатка", () => {
    useAuthStore.setState({
      user: user({ cups: 1800, cups_rank: "red", cups_floor: 1500, cups_to_next: null }),
      status: "authed",
    });
    render(<CupsPage />);

    expect(screen.getByText("Все рубежи взяты.")).toBeTruthy();
    expect(screen.queryByText(/До ранга/)).toBeNull();
  });

  it("гость (user === null) → ничего не рендерит", () => {
    useAuthStore.setState({ user: null, status: "anon" });
    const { container } = render(<CupsPage />);

    expect(container.innerHTML).toBe("");
  });
});
