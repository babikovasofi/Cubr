// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";
import { ApiError } from "../../src/api/client";
import type { SolveRead } from "../../src/api/solves";
import { useSettingsStore } from "../../src/store/settingsStore";

const { useAuthStoreMock, updateMeMock, listSolvesMock } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
  listSolvesMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: useAuthStoreMock,
}));

// Mock the CubeList and History components to focus on the public_handle field
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
  nickname: "TestNick",
  avatar_url: null,
  cups: 0,
  best_single_ms: null,
  best_ao5_ms: null,
  public_handle: "SpeedCuber",
};

beforeEach(() => {
  updateMeMock.mockReset();
  useAuthStoreMock.mockReset();
  listSolvesMock.mockReset();
  listSolvesMock.mockResolvedValue([]);
});

describe("ProfilePage — public_handle field", () => {
  it("renders 'Публичное имя в турнире' input with public notice", () => {
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

    expect(screen.getByLabelText("Публичное имя в турнире")).toBeTruthy();

    // Public notice text
    expect(
      screen.getByText(/Это имя увидят другие участники турнира в таблице недели/),
    ).toBeTruthy();
    expect(screen.getByText(/Оставь поле пустым — и там будет стоять «Аноним»/)).toBeTruthy();
  });

  it("saves public_handle via PATCH /users/me when form submitted", async () => {
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

    const input = screen.getByLabelText("Публичное имя в турнире") as HTMLInputElement;
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

    // Verify updateMe was called with the public_handle
    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          public_handle: "NewHandle",
        }),
      );
    });
  });

  it("sends null when public_handle field is empty (cleared)", async () => {
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

    const input = screen.getByLabelText("Публичное имя в турнире") as HTMLInputElement;

    // Clear the value
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });

    // Submit the form
    const submitButton = screen.getByRole("button", { name: "Сохранить" });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify updateMe was called with public_handle: null
    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          public_handle: null,
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

    const input = screen.getByLabelText("Публичное имя в турнире") as HTMLInputElement;
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
  it("показывает причину, когда фильтр имён отклонил публичное имя", async () => {
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

    const input = screen.getByLabelText("Публичное имя в турнире") as HTMLInputElement;
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

  it("handles unset public_handle (null) by showing empty input", () => {
    updateMeMock.mockResolvedValue(undefined);
    const userWithoutHandle = { ...MOCK_USER, public_handle: null };
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

    const input = screen.getByLabelText("Публичное имя в турнире") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("ProfilePage — time-format setting", () => {
  beforeEach(() => {
    useSettingsStore.setState({ timeFormat: "clock" });
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: { ...MOCK_USER, best_single_ms: 65000 }, updateMe: updateMeMock }),
    );
  });

  it("renders the «Формат времени» radios and switches the displayed record", () => {
    render(
      <BrowserRouter>
        <ProfilePage />
      </BrowserRouter>,
    );

    // Two radios (clock, seconds); clock is the default so the record shows M:SS.
    const radios = screen.getAllByRole("radio");
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
