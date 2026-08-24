// @vitest-environment jsdom
//
// Dashboard-филлеры (plan: design-fillers): прогресс/CupsRoad только у
// авторизованных, и только внутри Dashboard() — гость их не видит.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SolveRead } from "../../src/api/solves";
import type { UserRead } from "../../src/api/auth";

vi.mock("../../src/api/duel", () => ({
  createRoom: vi.fn(),
  saveDuelSessionToken: vi.fn(),
}));

const { listSolvesMock, getBadgesMock } = vi.hoisted(() => ({
  listSolvesMock: vi.fn(),
  getBadgesMock: vi.fn(),
}));

vi.mock("../../src/api/solves", () => ({ listSolves: listSolvesMock }));
vi.mock("../../src/api/badges", () => ({ getBadges: getBadgesMock }));

import HomePage from "../../src/pages/HomePage";
import { useAuthStore } from "../../src/store/authStore";

function solve(time_ms: number, status = "valid"): SolveRead {
  return {
    id: `${time_ms}-${status}-${Math.random()}`,
    scramble: "R U R' U'",
    time_ms,
    status,
    verify_frames_ok: false,
    cube_id: null,
    scramble_id: null,
    created_at: "2026-07-28T10:00:00Z",
  };
}

function authedUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: "u-1",
    email: "a@b.com",
    is_active: true,
    is_superuser: false,
    is_verified: true,
    avatar_url: null,
    cups: 450,
    cups_rank: "green",
    cups_floor: 300,
    cups_to_next: 300,
    best_single_ms: null,
    best_ao5_ms: null,
    handle: "Тестер",
    method: null,
    cubing_since_year: null,
    onboarded_at: null,
    created_at: null,
    ...overrides,
  };
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listSolvesMock.mockReset();
  getBadgesMock.mockReset();
  getBadgesMock.mockResolvedValue([]);
});

describe("Dashboard — прогресс и CupsRoad (authed)", () => {
  it("непустые сборки → показывает прогресс (Цель / Прогресс времени) и лестницу рангов", async () => {
    listSolvesMock.mockResolvedValue([solve(33_000), solve(31_000)]);
    useAuthStore.setState({ user: authedUser(), status: "authed" });

    renderHome();

    await waitFor(() => expect(screen.getByText("Прогресс времени")).toBeTruthy());
    expect(screen.getByText(/Цель/)).toBeTruthy();
    expect(screen.getByText("Лестница рангов")).toBeTruthy();
    expect(screen.queryByText("Пока нет сборок")).toBeNull();
  });

  it("пустые сборки → одна EmptyState-заглушка на /solo, без графика и без трёх карточек", async () => {
    listSolvesMock.mockResolvedValue([]);
    useAuthStore.setState({ user: authedUser(), status: "authed" });

    renderHome();

    await waitFor(() => expect(screen.getByText("Пока нет сборок")).toBeTruthy());
    expect(screen.queryByText("Прогресс времени")).toBeNull();
    expect(screen.getByRole("link", { name: "Собери первый кубик →" }).getAttribute("href")).toBe(
      "/solo",
    );
  });
});

describe("Dashboard — гость", () => {
  it("аноним не видит ни CupsRoad, ни прогресс, ни Dashboard-заглушку", () => {
    useAuthStore.setState({ user: null, status: "anon" });

    renderHome();

    expect(screen.queryByText("Лестница рангов")).toBeNull();
    expect(screen.queryByText("Пока нет сборок")).toBeNull();
    expect(listSolvesMock).not.toHaveBeenCalled();
  });
});

describe("Dashboard — useSolves ошибка", () => {
  it("listSolves reject → состояние error, страница не падает", async () => {
    const error = new Error("Network error");
    listSolvesMock.mockRejectedValue(error);
    useAuthStore.setState({ user: authedUser(), status: "authed" });

    renderHome();

    // Дожидаемся, пока ошибка обработается
    await waitFor(() => {
      expect(listSolvesMock).toHaveBeenCalledWith(50, 0);
    });

    // Страница не должна упасть; гость видит только Landing
    // (или другой fallback — тут главное, что не краш)
    expect(screen.queryByText("Прогресс времени")).toBeNull();
  });
});
