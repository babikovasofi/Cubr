// @vitest-environment jsdom
//
// Records на профиле: best_single_ms === null → EmptyState вместо грида «—».
// Кубки остаются своей карточкой — их начисляют дуэли, а не соло-сборки.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";

const { useAuthStoreMock, listSolvesMock } = vi.hoisted(() => ({
  useAuthStoreMock: vi.fn(),
  listSolvesMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({ useAuthStore: useAuthStoreMock }));
vi.mock("../../src/api/solves", () => ({ listSolves: listSolvesMock }));

const BASE_USER = {
  id: "user-1",
  email: "a@b.com",
  is_active: true,
  is_verified: true,
  is_superuser: false,
  avatar_url: null,
  cups: 42,
  cups_rank: "white",
  cups_floor: 0,
  cups_to_next: 50,
  handle: "SpeedCuber",
};

beforeEach(() => {
  useAuthStoreMock.mockReset();
  listSolvesMock.mockReset();
  listSolvesMock.mockResolvedValue([]);
});

describe("ProfilePage — Records пустые", () => {
  it("best_single_ms===null → EmptyState с CTA /solo, кубки остаются числом", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...BASE_USER, best_single_ms: null, best_ao5_ms: null },
        updateMe: vi.fn(),
      }),
    );

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    expect(screen.getByText("Рекордов пока нет")).toBeTruthy();
    const link = screen.getByRole("link", { name: "К соло-тренировке →" });
    expect(link.getAttribute("href")).toBe("/solo");
    // Кубки остаются числом (теперь и в бейдже шапки, и в карточке — оба «42»).
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.queryByText("Лучшая сборка")).toBeNull();
  });

  it("best задан → обычный грид рекордов, без EmptyState", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...BASE_USER, best_single_ms: 65000, best_ao5_ms: null },
        updateMe: vi.fn(),
      }),
    );

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    expect(screen.getByText("Лучшая сборка")).toBeTruthy();
    expect(screen.queryByText("Рекордов пока нет")).toBeNull();
  });
});
