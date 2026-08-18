// @vitest-environment jsdom
//
// Провал чанка словаря `en` (оборвалась сеть, выкатили новую версию, пока
// вкладка была открыта) не должен ронять интерфейс. Деградация — как у
// RouteErrorBoundary для упавших роутов (см. её комментарий): интерфейс
// остаётся на русском, а не превращается в белый экран или необработанное
// исключение.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../src/i18n/en", () => {
  throw new Error("chunk load failed");
});

import { useT, isEnDictReady } from "../../src/i18n/t";
import { useLangStore } from "../../src/store/langStore";

function Greeting() {
  const t = useT();
  return <p>{t("Правила")}</p>;
}

beforeEach(() => {
  useLangStore.setState({ lang: "ru" });
  // Ошибка загрузки чанка уходит в console.error (см. t.ts) — ожидаемый шум.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("сбой загрузки словаря en", () => {
  it("оставляет интерфейс на русском, а не роняет его", async () => {
    render(<Greeting />);
    useLangStore.setState({ lang: "en" });

    // Даём промису отклониться и убеждаемся, что попытка не удалась, а
    // интерфейс продолжает показывать русский текст.
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(isEnDictReady()).toBe(false);
    expect(screen.getByText("Правила")).toBeTruthy();
  });
});
