// @vitest-environment jsdom
//
// CupsRoad не хранит собственную таблицу порогов — все числа (floor,
// to_next) идут прямо из user (см. src/components/CupsRoad.tsx).

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
  it("cups в середине лесенки: виден текущий ранг, следующий и остаток, ровно один 🏆", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 300 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("Зелёный")).toBeTruthy();
    expect(screen.getByText(/До ранга «Синий» осталось 300 кубков\./)).toBeTruthy();
    const trophies = screen.getAllByText(/🏆/);
    expect(trophies).toHaveLength(1);
  });

  it("cups=0 → первый ранг, ещё не atMax", () => {
    useAuthStore.setState({
      user: user({ cups: 0, cups_rank: "white", cups_floor: 0, cups_to_next: 100 }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("Белый")).toBeTruthy();
    expect(screen.getByText(/До ранга «Жёлтый» осталось 100 кубков\./)).toBeTruthy();
    expect(screen.queryByText(/Все рубежи взяты/)).toBeNull();
  });

  it("cups_to_next === null (red, атMax) → все рубежи взяты, без строки следующего", () => {
    useAuthStore.setState({
      user: user({ cups: 1800, cups_rank: "red", cups_floor: 1500, cups_to_next: null }),
      status: "authed",
    });
    render(<CupsRoad />);

    expect(screen.getByText("Красный")).toBeTruthy();
    expect(screen.getByText(/Все рубежи взяты\./)).toBeTruthy();
    expect(screen.queryByText(/До ранга/)).toBeNull();
  });
});
