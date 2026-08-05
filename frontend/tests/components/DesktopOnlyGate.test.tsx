// @vitest-environment jsdom
//
// Заглушка для мобильных (Этап 6, R8). Главное свойство: на телефоне дети гейта
// НЕ монтируются вовсе — иначе камера/WS ритуала поднялись бы под заглушкой.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DesktopOnlyGate from "../../src/components/DesktopOnlyGate";
import { useDeviceStore } from "../../src/store/deviceStore";

const listeners = new Set<() => void>();

/** Ставит matchMedia, отвечающий `matches` на handheld-запрос, с рабочим `change`. */
function setHandheld(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderGate() {
  return render(
    <MemoryRouter>
      <DesktopOnlyGate>
        <p>ритуал</p>
      </DesktopOnlyGate>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listeners.clear();
  sessionStorage.clear();
  useDeviceStore.setState({ handheldOverride: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DesktopOnlyGate", () => {
  it("десктоп: рендерит детей, заглушки нет", () => {
    setHandheld(false);
    renderGate();

    expect(screen.getByText("ритуал")).toBeTruthy();
    expect(screen.queryByText("Сборку судит камера компьютера")).toBeNull();
  });

  it("телефон: заглушка вместо детей — ритуал не монтируется", () => {
    setHandheld(true);
    renderGate();

    expect(screen.getByText("Сборку судит камера компьютера")).toBeTruthy();
    expect(screen.queryByText("ритуал")).toBeNull();
  });

  it("«Всё равно открыть здесь» пускает дальше и переживает перемонтирование", () => {
    setHandheld(true);
    renderGate();

    fireEvent.click(screen.getByRole("button", { name: "Всё равно открыть здесь" }));
    expect(screen.getByText("ритуал")).toBeTruthy();

    cleanup();
    renderGate();
    expect(screen.getByText("ритуал")).toBeTruthy();
    expect(sessionStorage.getItem("cubr_handheld_override")).toBe("1");
  });

  it("смена media-состояния переоценивает гейт", () => {
    setHandheld(false);
    renderGate();
    expect(screen.getByText("ритуал")).toBeTruthy();

    setHandheld(true);
    act(() => {
      listeners.forEach((cb) => cb());
    });
    expect(screen.getByText("Сборку судит камера компьютера")).toBeTruthy();
    expect(screen.queryByText("ритуал")).toBeNull();
  });

  it("копирует адрес сайта в буфер", async () => {
    setHandheld(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGate();

    fireEvent.click(screen.getByRole("button", { name: "Скопировать ссылку" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ссылка скопирована" })).toBeTruthy(),
    );
    // Копируется текущий адрес целиком — иначе приглашение в дуэль потеряло бы токен.
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("отказ буфера обмена не роняет заглушку", async () => {
    setHandheld(true);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderGate();

    fireEvent.click(screen.getByRole("button", { name: "Скопировать ссылку" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Скопировать ссылку" })).toBeTruthy();
    expect(screen.getByText("Сборку судит камера компьютера")).toBeTruthy();
  });
});
