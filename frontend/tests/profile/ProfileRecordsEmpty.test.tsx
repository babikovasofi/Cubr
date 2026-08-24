// @vitest-environment jsdom
//
// Records на профиле: best_single_ms === null → EmptyState вместо грида «—».
// Кубки остаются своей карточкой — их начисляют дуэли, а не соло-сборки.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";

const { useAuthStoreMock, updateMeMock, listSolvesMock } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
  listSolvesMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({ useAuthStore: useAuthStoreMock }));
vi.mock("../../src/cubes/CubeList", () => ({
  default: () => <div data-testid="cube-list">Cube List</div>,
}));
vi.mock("../../src/api/solves", () => ({ listSolves: listSolvesMock }));

const BASE_USER = {
  id: "user-1",
  email: "a@b.com",
  is_active: true,
  is_verified: true,
  is_superuser: false,
  avatar_url: null,
  cups: 42,
  handle: "SpeedCuber",
};

beforeEach(() => {
  updateMeMock.mockReset();
  useAuthStoreMock.mockReset();
  listSolvesMock.mockReset();
  listSolvesMock.mockResolvedValue([]);
});

describe("ProfilePage — Records пустые", () => {
  it("best_single_ms===null → EmptyState с CTA /solo, кубки остаются числом", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...BASE_USER, best_single_ms: null, best_ao5_ms: null },
        updateMe: updateMeMock,
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
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.queryByText("Лучшая сборка")).toBeNull();
  });

  it("best задан → обычный грид рекордов, без EmptyState", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...BASE_USER, best_single_ms: 65000, best_ao5_ms: null },
        updateMe: updateMeMock,
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
