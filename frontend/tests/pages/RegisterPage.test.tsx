// @vitest-environment jsdom
//
// Регистрация (single-handle-work): поле теперь "Ник" (а не "Никнейм"), уезжает
// в register() как handle, ведущая собака молча срезается по вводу, а занятое
// имя (HANDLE_TAKEN) читается понятной фразой, а не общей ошибкой.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RegisterPage from "../../src/pages/RegisterPage";
import { ApiError } from "../../src/api/client";

const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: (selector: (s: { register: typeof registerMock }) => unknown) =>
    selector({ register: registerMock }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  registerMock.mockReset();
});

afterEach(cleanup);

describe("RegisterPage — поле «Ник»", () => {
  it("срезает ведущую собаку при вводе", async () => {
    renderPage();
    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "@SpeedCuber" } });
    });
    expect(input.value).toBe("SpeedCuber");
  });

  it("уходит в register() как handle, без ведущей собаки", async () => {
    registerMock.mockResolvedValue(undefined);
    renderPage();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Почта"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Ник"), { target: { value: "@SpeedCuber" } });
      fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "verysecret1" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    });

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("test@example.com", "verysecret1", "SpeedCuber");
    });
  });

  it("пустой ник не передаётся вовсе (undefined)", async () => {
    registerMock.mockResolvedValue(undefined);
    renderPage();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Почта"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "verysecret1" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    });

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("test@example.com", "verysecret1", undefined);
    });
  });

  it("показывает «имя занято», когда сервер отвечает HANDLE_TAKEN", async () => {
    registerMock.mockRejectedValue(
      new ApiError(400, "HANDLE_TAKEN", "Это имя уже занято другим пользователем."),
    );
    renderPage();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Почта"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Ник"), { target: { value: "TakenHandle" } });
      fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "verysecret1" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Это имя уже занято другим пользователем.")).toBeTruthy();
    });
    // Форма не переключилась на "подтвердите почту" — регистрация НЕ прошла.
    expect(screen.queryByText("Подтвердите почту")).toBeNull();
  });
});
