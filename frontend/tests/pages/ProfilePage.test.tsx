// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ProfilePage from "../../src/pages/ProfilePage";

const { useAuthStoreMock, updateMeMock } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: useAuthStoreMock,
}));

// Mock the CubeList and History components to focus on the public_handle field
vi.mock("../../src/cubes/CubeList", () => ({
  default: () => <div data-testid="cube-list">Cube List</div>,
}));

// Mock listSolves to avoid loading
vi.mock("../../src/api/solves", () => ({
  listSolves: vi.fn().mockResolvedValue([]),
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
    expect(
      screen.getByText(/Оставь поле пустым — и там будет стоять «Аноним»/),
    ).toBeTruthy();
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
