// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";
import type { SolveRead } from "../../src/api/solves";
import { useSettingsStore } from "../../src/store/settingsStore";
import { useLangStore } from "../../src/store/langStore";
import { loadEnDict } from "../../src/i18n/t";

const { useAuthStoreMock, listSolvesMock } = vi.hoisted(() => ({
  useAuthStoreMock: vi.fn(),
  listSolvesMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock("../../src/api/solves", () => ({
  listSolves: listSolvesMock,
}));

const MOCK_USER = {
  id: "user-123",
  email: "test@example.com",
  is_active: true,
  is_verified: true,
  is_superuser: false,
  avatar_url: null,
  cups: 0,
  cups_rank: "white",
  cups_floor: 0,
  cups_to_next: 50,
  best_single_ms: null,
  best_ao5_ms: null,
  handle: "SpeedCuber",
};

beforeEach(() => {
  useAuthStoreMock.mockReset();
  listSolvesMock.mockReset();
  listSolvesMock.mockResolvedValue([]);
  useAuthStoreMock.mockImplementation((selector) =>
    selector({ user: MOCK_USER, updateMe: vi.fn() }),
  );
});

function renderPage() {
  return render(
    <BrowserRouter>
      <ProfilePage />
    </BrowserRouter>,
  );
}

describe("ProfilePage — header", () => {
  it("shows the handle with a leading @ and a link to /settings", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "@SpeedCuber" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Настройки" }).getAttribute("href")).toBe("/settings");
  });

  it("handles unset handle (null) with an honest fallback + CTA into /settings", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, handle: null }, updateMe: vi.fn() }),
    );
    renderPage();
    expect(screen.getByRole("heading", { name: "Без ника" })).toBeTruthy();
    expect(screen.queryByText(/^@null$/)).toBeNull();
    const link = screen.getByRole("link", { name: "Задать имя в профиле" });
    expect(link.getAttribute("href")).toBe("/settings#profile-handle");
  });

  it("cups badge links to /cups", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, cups: 42 }, updateMe: vi.fn() }),
    );
    renderPage();
    const link = screen.getByRole("link", { name: /42 кубков/ });
    expect(link.getAttribute("href")).toBe("/cups");
  });
});

describe("ProfilePage — Records", () => {
  it("best_single_ms===null → EmptyState с CTA /solo, кубки остаются числом", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...MOCK_USER, cups: 42, best_single_ms: null, best_ao5_ms: null },
        updateMe: vi.fn(),
      }),
    );
    renderPage();

    expect(screen.getByText("Рекордов пока нет")).toBeTruthy();
    const link = screen.getByRole("link", { name: "К соло-тренировке →" });
    expect(link.getAttribute("href")).toBe("/solo");
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.queryByText("Лучшая сборка")).toBeNull();
  });

  it("best задан → обычный грид рекордов, без EmptyState", () => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({
        user: { ...MOCK_USER, best_single_ms: 65000, best_ao5_ms: null },
        updateMe: vi.fn(),
      }),
    );
    renderPage();

    expect(screen.getByText("Лучшая сборка")).toBeTruthy();
    expect(screen.queryByText("Рекордов пока нет")).toBeNull();
  });
});

// The time-format TOGGLE itself now lives on /settings (SettingsPage.test.tsx)
// — this only checks that Records reads useSettingsStore correctly here too.
describe("ProfilePage — records respect the stored time format", () => {
  beforeEach(() => {
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, best_single_ms: 65000 }, updateMe: vi.fn() }),
    );
  });

  it("clock format shows mm:ss.cc", () => {
    useSettingsStore.setState({ timeFormat: "clock" });
    renderPage();
    expect(screen.getByText("1:05.00")).toBeTruthy();
  });

  it("seconds format shows plain seconds", () => {
    useSettingsStore.setState({ timeFormat: "seconds" });
    renderPage();
    expect(screen.getByText("65.00")).toBeTruthy();
    useSettingsStore.setState({ timeFormat: "clock" });
  });
});

describe("ProfilePage — Progress + History", () => {
  it("renders Прогресс времени + History table with valid+dnf mix, listSolves called exactly ONCE", async () => {
    const mockSolves: SolveRead[] = [
      {
        id: "solve-1",
        scramble: "R U R' U'",
        time_ms: 15000,
        status: "valid",
        verify_frames_ok: true,
        cube_id: null,
        scramble_id: null,
        created_at: new Date(Date.now() - 3000).toISOString(),
      },
      {
        id: "solve-2",
        scramble: "R U R' U'",
        time_ms: 5000,
        status: "dnf",
        verify_frames_ok: true,
        cube_id: null,
        scramble_id: null,
        created_at: new Date(Date.now() - 2000).toISOString(),
      },
      {
        id: "solve-3",
        scramble: "R U R' U'",
        time_ms: 14000,
        status: "valid",
        verify_frames_ok: true,
        cube_id: null,
        scramble_id: null,
        created_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];

    listSolvesMock.mockResolvedValue(mockSolves);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Прогресс времени")).toBeTruthy();
    });

    // The single useSolves() call is shared by both the Progress card and the
    // History card — this is the whole point of lifting it in ProfilePage.
    expect(listSolvesMock).toHaveBeenCalledTimes(1);
    expect(listSolvesMock).toHaveBeenCalledWith(50, 0);

    expect(screen.getByText("за последние сборки")).toBeTruthy();

    const svg = screen.getByRole("img", { name: /График времени сборок/ });
    expect(svg).toBeTruthy();

    expect(screen.getByText("Время")).toBeTruthy();
    expect(screen.getByText("Статус")).toBeTruthy();
    expect(screen.getByText("Когда")).toBeTruthy();

    const tableRows = screen.getAllByRole("row");
    expect(tableRows.length).toBeGreaterThanOrEqual(4); // header + 3 data rows
  });
});

// Чеклист состояний userflow §10: «история сборок пуста». Пустой экран должен
// звать в соло, а не показывать голую таблицу.
describe("ProfilePage — пустая история (userflow §10)", () => {
  it("пустая история зовёт в соло-режим", async () => {
    listSolvesMock.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText(/Пока нет сохранённых сборок/)).toBeTruthy());
    const links = screen.getAllByRole("link", { name: /К соло-тренировке/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => a.getAttribute("href") === "/solo")).toBe(true);
  });
});

// Локализация, проход 2: профиль говорит по-английски целиком (карточки рекордов,
// заголовки карточек). Полнота словаря — забота tests/i18n/coverage.test.ts.
describe("ProfilePage — английский", () => {
  it("переводит карточки рекордов и заголовки", async () => {
    await loadEnDict();
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, best_single_ms: 65000 }, updateMe: vi.fn() }),
    );
    act(() => useLangStore.setState({ lang: "en" }));
    try {
      renderPage();
      expect(screen.getByText("Best single")).toBeTruthy();
      expect(screen.getByText("Records")).toBeTruthy();
      expect(screen.getByText("Progress")).toBeTruthy();
      expect(screen.queryByText("Лучшая сборка")).toBeNull();
    } finally {
      act(() => useLangStore.setState({ lang: "ru" }));
    }
  });
});
