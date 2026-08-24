// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";
import { ApiError } from "../../src/api/client";
import type { SolveRead } from "../../src/api/solves";
import { useSettingsStore } from "../../src/store/settingsStore";
import { useLangStore } from "../../src/store/langStore";
import { loadEnDict } from "../../src/i18n/t";

const { useAuthStoreMock, updateMeMock, listSolvesMock } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
  listSolvesMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: useAuthStoreMock,
}));

// Mock the CubeList and History components to focus on the handle field
vi.mock("../../src/cubes/CubeList", () => ({
  default: () => <div data-testid="cube-list">Cube List</div>,
}));

// Mock listSolves
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
  best_single_ms: null,
  best_ao5_ms: null,
  handle: "SpeedCuber",
};

beforeEach(() => {
  updateMeMock.mockReset();
  useAuthStoreMock.mockReset();
  listSolvesMock.mockReset();
  listSolvesMock.mockResolvedValue([]);
});

describe("ProfilePage — поле handle", () => {
  it("renders 'Ник' input with notice, and header shows «@ник»", () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: MOCK_USER,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    expect(screen.getByLabelText("Ник")).toBeTruthy();

    // Header shows the handle WITH a leading "@" — the stored value itself has none.
    expect(screen.getByRole("heading", { name: "@SpeedCuber" })).toBeTruthy();

    // Notice text — honest about every surface this name reaches (now including own header).
    expect(
      screen.getByText(/в шапке профиля, списке друзей и таблицах турнира и скрамбла дня/),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Не задано — покажем как «Аноним»")).toBeTruthy();
  });

  it("input value is the bare handle, without the leading @", () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: MOCK_USER, updateMe: updateMeMock }),
    );

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    expect(input.value).toBe("SpeedCuber");
  });

  it("если набрать «@ник» вручную, ведущая собака молча срезается", async () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: MOCK_USER, updateMe: updateMeMock }),
    );

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "@NewHandle" } });
    });
    expect(input.value).toBe("NewHandle");
  });

  it("saves handle via PATCH /users/me when form submitted", async () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: MOCK_USER,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    expect(input.value).toBe("SpeedCuber");

    // Change the value
    await act(async () => {
      fireEvent.change(input, { target: { value: "NewHandle" } });
    });

    // Submit the form
    const submitButton = screen.getByRole("button", { name: "Сохранить" });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify updateMe was called with the handle
    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: "NewHandle",
        }),
      );
    });
  });

  it("sends null when handle field is empty (cleared)", async () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: MOCK_USER,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;

    // Clear the value
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });

    // Submit the form
    const submitButton = screen.getByRole("button", { name: "Сохранить" });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify updateMe was called with handle: null
    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: null,
        }),
      );
    });
  });

  it("displays 'Сохранено' message after successful save", async () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: MOCK_USER,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Updated" } });
    });

    const submitButton = screen.getByRole("button", { name: "Сохранить" });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(screen.getByText("Сохранено")).toBeTruthy();
    });
  });

  // Этап 6: серверный фильтр имён отвечает 400 {code, reason} — пользователь должен
  // увидеть внятную причину, а не молча несохранённую форму.
  it("показывает причину, когда фильтр имён отклонил ник", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "NAME_NOT_ALLOWED", "Такое имя не подходит. Выбери другое."),
    );
    useAuthStoreMock.mockImplementation((selector) => {
      const state = { user: MOCK_USER, updateMe: updateMeMock };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "мудак" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Такое имя не подходит. Выбери другое.")).toBeTruthy();
    });
    expect(screen.queryByText("Сохранено")).toBeNull();
  });

  // Новая ошибка контракта (single-handle-work): занятый ник при сохранении
  // профиля должен читаться понятно, а не как обобщённое «не удалось».
  it("показывает «занято», когда сохранение ловит HANDLE_TAKEN", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "HANDLE_TAKEN", "Это имя уже занято другим пользователем."),
    );
    useAuthStoreMock.mockImplementation((selector) => {
      const state = { user: MOCK_USER, updateMe: updateMeMock };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "TakenHandle" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Это имя уже занято другим пользователем.")).toBeTruthy();
    });
    expect(screen.queryByText("Сохранено")).toBeNull();
  });

  it("handles unset handle (null) by showing empty input, honest header fallback and a CTA", () => {
    updateMeMock.mockResolvedValue(undefined);
    const userWithoutHandle = { ...MOCK_USER, handle: null };
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: userWithoutHandle,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    expect(input.value).toBe("");

    // Honest empty state: no "@null", no blank heading — same fallback text as
    // before, plus a link to go set it right below.
    expect(screen.getByRole("heading", { name: "Без ника" })).toBeTruthy();
    expect(screen.queryByText(/^@null$/)).toBeNull();
    expect(screen.getByRole("link", { name: "Задать имя в профиле" })).toBeTruthy();
  });
});

describe("ProfilePage — time-format setting", () => {
  beforeEach(() => {
    useSettingsStore.setState({ timeFormat: "clock" });
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, best_single_ms: 65000 }, updateMe: updateMeMock }),
    );
  });

  it("переключает формат времени и меняет показанный рекорд", () => {
    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    // Переключатель формата — своя радиогруппа (на странице есть и другая, метод
    // сборки), поэтому ищем внутри неё, а не по всей странице.
    const group = screen.getByRole("radiogroup", { name: "Формат времени" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByText("1:05.00")).toBeTruthy();

    // Switch to seconds → the same record re-renders as plain seconds.
    act(() => {
      fireEvent.click(radios[1]);
    });
    expect(useSettingsStore.getState().timeFormat).toBe("seconds");
    expect(screen.getByText("65.00")).toBeTruthy();
    expect(screen.queryByText("1:05.00")).toBeNull();
  });
});

describe("ProfilePage — Progress Chart + History", () => {
  it("renders both Прогресс времени heading and History table with valid+dnf mix, listSolves called exactly ONCE", async () => {
    updateMeMock.mockResolvedValue(undefined);
    useAuthStoreMock.mockImplementation((selector) => {
      const state = {
        user: MOCK_USER,
        updateMe: updateMeMock,
      };
      return selector(state);
    });

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

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    // Wait for the history to load
    await waitFor(() => {
      expect(screen.getByText("Прогресс времени")).toBeTruthy();
    });

    // Verify listSolves was called exactly once
    expect(listSolvesMock).toHaveBeenCalledTimes(1);
    expect(listSolvesMock).toHaveBeenCalledWith(50, 0);

    // Verify "Прогресс времени" heading is rendered
    expect(screen.getByText("Прогресс времени")).toBeTruthy();
    expect(screen.getByText("за последние сборки")).toBeTruthy();

    // Verify the chart SVG is rendered
    const svg = screen.getByRole("img", { name: /График времени сборок/ });
    expect(svg).toBeTruthy();

    // Verify History table is rendered with solves
    expect(screen.getByText("Время")).toBeTruthy();
    expect(screen.getByText("Статус")).toBeTruthy();
    expect(screen.getByText("Когда")).toBeTruthy();

    // Verify table rows are present (3 solves)
    const tableRows = screen.getAllByRole("row");
    expect(tableRows.length).toBeGreaterThanOrEqual(4); // header + 3 data rows
  });
});

// Чеклист состояний userflow §10: «история сборок пуста». Пустой экран должен
// звать в соло, а не показывать голую таблицу.
describe("ProfilePage — пустая история (userflow §10)", () => {
  it("пустая история зовёт в соло-режим", async () => {
    listSolvesMock.mockResolvedValue([]);
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: MOCK_USER, updateMe: updateMeMock }),
    );

    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Пока нет сохранённых сборок/)).toBeTruthy());
    // Ссылок «в соло» на пустом профиле две (пустая история + пустой график) —
    // обе ведут туда же, важно что путь ведёт в ритуал.
    const links = screen.getAllByRole("link", { name: /К соло-тренировке/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => a.getAttribute("href") === "/solo")).toBe(true);
  });
});

// Локализация, проход 2: профиль говорит по-английски целиком (карточки рекордов,
// настройки, история). Полнота словаря — забота tests/i18n/coverage.test.ts.
describe("ProfilePage — английский", () => {
  it("переводит карточки рекордов и заголовки", async () => {
    // en — ленивый чанк (см. src/i18n/t.ts); догружаем явно перед рендером.
    await loadEnDict();
    // best_single_ms must be set here: null now renders the "no records yet"
    // EmptyState instead of the record cards this test is localizing.
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, best_single_ms: 65000 }, updateMe: updateMeMock }),
    );
    act(() => useLangStore.setState({ lang: "en" }));
    try {
      render(
        <BrowserRouter>
          <ProfilePage />
        </BrowserRouter>,
      );
      expect(screen.getByText("Best single")).toBeTruthy();
      expect(screen.getByText("Showcase")).toBeTruthy();
      expect(screen.queryByText("Лучшая сборка")).toBeNull();
    } finally {
      act(() => useLangStore.setState({ lang: "ru" }));
    }
  });
});
