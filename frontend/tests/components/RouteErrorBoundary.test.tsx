// @vitest-environment jsdom
//
// Граница вокруг ленивых роутов. Проверяется ровно то, ради чего она есть:
// упавшая загрузка чанка даёт текст и кнопку, а не белый экран.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import RouteErrorBoundary from "../../src/components/RouteErrorBoundary";
import { useLangStore } from "../../src/store/langStore";

function Boom(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

beforeEach(() => {
  useLangStore.setState({ lang: "ru" });
  // React печатает пойманную ошибку сам; в выводе тестов это шум.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("RouteErrorBoundary", () => {
  it("здоровое поддерево рисуется как есть", () => {
    render(
      <RouteErrorBoundary>
        <p>содержимое страницы</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("содержимое страницы")).toBeTruthy();
  });

  it("упавший чанк даёт объяснение и кнопку перезагрузки, а не пустоту", () => {
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Не удалось загрузить эту страницу");

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    fireEvent.click(screen.getByRole("button", { name: "Обновить страницу" }));
    expect(reload).toHaveBeenCalled();
  });

  it("текст следует за языком интерфейса", async () => {
    useLangStore.setState({ lang: "en" });
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );
    // Словарь `en` — отдельный чанк, догружается после коммита (см. useT()),
    // поэтому первый кадр ещё русский — ждём перевод, а не читаем его сразу.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not load this page"),
    );
  });
});
