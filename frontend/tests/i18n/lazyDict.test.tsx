// @vitest-environment jsdom
//
// Ленивая загрузка словаря `en` (см. заголовок src/i18n/t.ts): на русском
// словарь ни разу не запрашивается, а переключение на английский на лету
// догружает его отдельным чанком и перерисовывает интерфейс.
//
// Порядок тестов в файле важен: первый тест проверяет, что словарь ЕЩЁ не
// загружен, а модульное состояние (DICTS.en) — синглтон на файл (vitest
// изолирует модули между файлами, не между тестами одного файла).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { useT, isEnDictReady } from "../../src/i18n/t";
import { useLangStore } from "../../src/store/langStore";

function Greeting() {
  const t = useT();
  return <p>{t("Правила")}</p>;
}

beforeEach(() => {
  useLangStore.setState({ lang: "ru" });
});

afterEach(() => {
  cleanup();
});

describe("ленивая загрузка словаря en", () => {
  it("на русском по умолчанию словарь не загружен", () => {
    render(<Greeting />);
    expect(screen.getByText("Правила")).toBeTruthy();
    expect(isEnDictReady()).toBe(false);
  });

  it("переключение на английский на лету догружает словарь и переводит интерфейс", async () => {
    render(<Greeting />);
    expect(screen.getByText("Правила")).toBeTruthy(); // до переключения — русский, без мигания

    useLangStore.setState({ lang: "en" });

    await waitFor(() => expect(screen.getByText("Rules")).toBeTruthy());
  });
});
