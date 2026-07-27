// @vitest-environment jsdom
//
// Этап 6: правила + приватность. Тексты — продуктовое обещание, поэтому тест
// стережёт не вёрстку, а ключевые честностные утверждения (кадры не уходят на
// сервер, мест/рейтинга нет, почта/ник не публикуются) и перелинковку страниц.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RulesPage from "../../src/pages/RulesPage";
import PrivacyPage from "../../src/pages/PrivacyPage";

function renderPage(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

describe("RulesPage", () => {
  it("описывает ритуал, DNF и окно попытки", () => {
    renderPage(<RulesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Правила" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ритуал сборки" })).toBeTruthy();
    expect(screen.getByText(/10 минут/)).toBeTruthy();
  });

  it("честно говорит, что рейтинга нет, пока время заявляет клиент", () => {
    renderPage(<RulesPage />);

    expect(screen.getByText(/Время сообщает браузер/)).toBeTruthy();
    expect(screen.getByText(/Поэтому нет мест и рейтинга/)).toBeTruthy();
  });

  it("ведёт на приватность", () => {
    renderPage(<RulesPage />);

    expect(screen.getByRole("link", { name: /Данные и приватность/ }).getAttribute("href")).toBe(
      "/privacy",
    );
  });
});

describe("PrivacyPage", () => {
  it("заявляет, что видео не покидает устройство", () => {
    renderPage(<PrivacyPage />);

    expect(screen.getByText(/Видео не покидает твой компьютер/)).toBeTruthy();
    expect(screen.getByText(/Запись сборки не ведётся/)).toBeTruthy();
  });

  it("перечисляет хранимое и обещает не публиковать почту и ник", () => {
    renderPage(<PrivacyPage />);

    expect(screen.getByRole("heading", { name: "Что хранится на сервере" })).toBeTruthy();
    expect(screen.getByText(/Почта\s+и ник не показываются/)).toBeTruthy();
  });

  it("даёт контакт для удаления аккаунта", () => {
    renderPage(<PrivacyPage />);

    const mail = screen.getByRole("link", { name: /@/ });
    expect(mail.getAttribute("href")?.startsWith("mailto:")).toBe(true);
  });

  it("ведёт на правила", () => {
    renderPage(<PrivacyPage />);

    expect(screen.getByRole("link", { name: /Правила/ }).getAttribute("href")).toBe("/rules");
  });
});
