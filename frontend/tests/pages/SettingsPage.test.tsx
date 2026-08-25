// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import SettingsPage from "../../src/pages/SettingsPage";
import { ApiError } from "../../src/api/client";
import { useLangStore } from "../../src/store/langStore";
import { useSettingsStore } from "../../src/store/settingsStore";
import { loadEnDict } from "../../src/i18n/t";

const { useAuthStoreMock, updateMeMock, getEmailPrefsMock, updateEmailPrefsMock } = vi.hoisted(
  () => ({
    updateMeMock: vi.fn(),
    useAuthStoreMock: vi.fn(),
    getEmailPrefsMock: vi.fn(),
    updateEmailPrefsMock: vi.fn(),
  }),
);

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: useAuthStoreMock,
}));

// CubeList does its own fetch (cubesStore) — not this page's concern.
vi.mock("../../src/cubes/CubeList", () => ({
  default: () => <div data-testid="cube-list">Cube List</div>,
}));

vi.mock("../../src/api/email", () => ({
  getEmailPrefs: getEmailPrefsMock,
  updateEmailPrefs: updateEmailPrefsMock,
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
  method: null,
  cubing_since_year: null,
};

beforeEach(() => {
  updateMeMock.mockReset();
  useAuthStoreMock.mockReset();
  getEmailPrefsMock.mockReset();
  updateEmailPrefsMock.mockReset();
  getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
  updateEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
  useAuthStoreMock.mockImplementation((selector) =>
    selector({ user: MOCK_USER, updateMe: updateMeMock }),
  );
});

function renderPage() {
  return render(
    <BrowserRouter>
      <SettingsPage />
    </BrowserRouter>,
  );
}

describe("SettingsPage — handle + avatar", () => {
  it("renders 'Ник' input pre-filled from the current user, no leading @", () => {
    renderPage();
    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    expect(input.value).toBe("SpeedCuber");
    expect(
      screen.getByText(/в шапке профиля, списке друзей и таблицах турнира и скрамбла дня/),
    ).toBeTruthy();
  });

  it("если набрать «@ник» вручную, ведущая собака молча срезается", async () => {
    renderPage();
    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "@NewHandle" } });
    });
    expect(input.value).toBe("NewHandle");
  });

  it("saves handle via PATCH /users/me when form submitted", async () => {
    updateMeMock.mockResolvedValue(undefined);
    renderPage();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "NewHandle" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    });

    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(expect.objectContaining({ handle: "NewHandle" }));
    });
  });

  it("sends null when handle field is empty (cleared)", async () => {
    updateMeMock.mockResolvedValue(undefined);
    renderPage();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    });

    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith(expect.objectContaining({ handle: null }));
    });
  });

  it("displays 'Сохранено' message after successful save", async () => {
    updateMeMock.mockResolvedValue(undefined);
    renderPage();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Updated" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Сохранено")).toBeTruthy();
    });
  });

  it("показывает причину, когда фильтр имён отклонил ник", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "NAME_NOT_ALLOWED", "Такое имя не подходит. Выбери другое."),
    );
    renderPage();

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

  it("показывает «занято», когда сохранение ловит HANDLE_TAKEN", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "HANDLE_TAKEN", "Это имя уже занято другим пользователем."),
    );
    renderPage();

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

  it("handles unset handle (null) by showing an empty input", () => {
    const userWithoutHandle = { ...MOCK_USER, handle: null };
    useAuthStoreMock.mockImplementation((selector) =>
      selector({ user: userWithoutHandle, updateMe: updateMeMock }),
    );
    renderPage();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("SettingsPage — time-format setting", () => {
  beforeEach(() => {
    useSettingsStore.setState({ timeFormat: "clock" });
  });

  it("переключает формат времени в сторе", () => {
    renderPage();

    const group = screen.getByRole("radiogroup", { name: "Формат времени" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);

    act(() => {
      fireEvent.click(radios[1]);
    });
    expect(useSettingsStore.getState().timeFormat).toBe("seconds");
    useSettingsStore.setState({ timeFormat: "clock" });
  });
});

describe("SettingsPage — English", () => {
  it("translates section titles and the showcase form", async () => {
    await loadEnDict();
    act(() => useLangStore.setState({ lang: "en" }));
    try {
      renderPage();
      expect(screen.getByText("Showcase")).toBeTruthy();
      expect(screen.getByText("Preferences")).toBeTruthy();
      expect(screen.queryByText("Витрина")).toBeNull();
    } finally {
      act(() => useLangStore.setState({ lang: "ru" }));
    }
  });
});

describe("SettingsPage — ChatEmailToggle (email preferences)", () => {
  it("reads GET /email/prefs on mount and shows current state", async () => {
    getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
    renderPage();

    expect(screen.getByText("Письма о новых сообщениях от друзей")).toBeTruthy();

    await waitFor(() => {
      expect(getEmailPrefsMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const toggles = screen.getAllByRole("radio") as HTMLInputElement[];
      const onToggle = toggles.find((r) => r.value === "on");
      expect(onToggle).toBeTruthy();
      expect(onToggle?.checked).toBe(true);
    });
  });

  it("shows loading state initially then ready state", async () => {
    getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
    renderPage();

    expect(screen.getByText("Загружаю настройку писем…")).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText("Загружаю настройку писем…")).toBeNull();
      expect(screen.getByRole("radio", { name: "Включены" })).toBeTruthy();
    });
  });

  it("shows error state when GET /email/prefs fails", async () => {
    getEmailPrefsMock.mockRejectedValue(new Error("Network error"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Не удалось загрузить настройку писем.")).toBeTruthy();
    });
  });

  it("calls PUT /email/prefs when toggling from on to off", async () => {
    getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
    updateEmailPrefsMock.mockResolvedValue({ chat_email_enabled: false });
    renderPage();

    await waitFor(() => {
      expect(getEmailPrefsMock).toHaveBeenCalledTimes(1);
    });

    const offToggle = await screen.findByRole("radio", { name: "Выключены" });
    await act(async () => {
      fireEvent.click(offToggle);
    });

    await waitFor(() => {
      expect(updateEmailPrefsMock).toHaveBeenCalled();
      expect(updateEmailPrefsMock.mock.calls[0][0]).toEqual({ chat_email_enabled: false });
    });
  });

  it("calls PUT /email/prefs when toggling from off to on", async () => {
    getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: false });
    updateEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
    renderPage();

    await waitFor(() => {
      expect(getEmailPrefsMock).toHaveBeenCalledTimes(1);
    });

    const onToggle = await screen.findByRole("radio", { name: "Включены" });
    await act(async () => {
      fireEvent.click(onToggle);
    });

    await waitFor(() => {
      expect(updateEmailPrefsMock).toHaveBeenCalled();
      expect(updateEmailPrefsMock.mock.calls[0][0]).toEqual({ chat_email_enabled: true });
    });
  });

  it("reverts toggle on PUT failure", async () => {
    getEmailPrefsMock.mockResolvedValue({ chat_email_enabled: true });
    updateEmailPrefsMock.mockRejectedValue(new Error("Save failed"));
    renderPage();

    await waitFor(() => {
      expect(getEmailPrefsMock).toHaveBeenCalledTimes(1);
    });

    const onToggle = (await screen.findByRole("radio", {
      name: "Включены",
    })) as HTMLInputElement;
    expect(onToggle.checked).toBe(true);

    const offToggle = screen.getByRole("radio", { name: "Выключены" });
    await act(async () => {
      fireEvent.click(offToggle);
    });

    await waitFor(() => {
      expect(updateEmailPrefsMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("radio", { name: "Включены", checked: true })).toBeTruthy();
    });
  });
});
