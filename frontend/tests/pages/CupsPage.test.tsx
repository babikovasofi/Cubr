// @vitest-environment jsdom
//
// Dedicated trophy-road screen (plan: cups-system). The hero (big count,
// current rank) is CupsPage's own; the horizontal road below it is CupsRoad,
// covered separately in tests/components/CupsRoad.test.tsx. A badge board of
// locked placeholder slots sits under the road.

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
  it("cups в середине лесенки: счёт и текущий ранг", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 300 }),
      status: "authed",
    });
    render(<CupsPage />);

    expect(screen.getByText("450")).toBeTruthy();
    // "Зелёный" встречается дважды: в шапке и в самой ступени лестницы.
    expect(screen.getAllByText("Зелёный")).toHaveLength(2);
    expect(screen.queryByText(/🏆/)).toBeNull();
  });

  it("cups_to_next === null (red, atMax) → «все рубежи взяты» в шапке", () => {
    useAuthStore.setState({
      user: user({ cups: 1800, cups_rank: "red", cups_floor: 1500, cups_to_next: null }),
      status: "authed",
    });
    render(<CupsPage />);

    // "Красный" встречается дважды: в шапке и в самой ступени лестницы.
    expect(screen.getAllByText("Красный")).toHaveLength(2);
    // «Все рубежи взяты.» встречается дважды: в шапке и на самой дороге.
    expect(screen.getAllByText("Все рубежи взяты.")).toHaveLength(2);
  });

  it("рисует запертую доску бейджей-плейсхолдеров", () => {
    useAuthStore.setState({
      user: user({ cups: 450, cups_rank: "green", cups_floor: 300, cups_to_next: 300 }),
      status: "authed",
    });
    render(<CupsPage />);

    expect(screen.getByText("Бейджи дороги")).toBeTruthy();
    expect(screen.getAllByText("?")).toHaveLength(8);
  });

  it("гость (user === null) → ничего не рендерит", () => {
    useAuthStore.setState({ user: null, status: "anon" });
    const { container } = render(<CupsPage />);

    expect(container.innerHTML).toBe("");
  });
});
