// @vitest-environment jsdom
//
// Этап 6, лендинг: одна страница "/" с двумя лицами. Проверяем ровно развилку
// (аноним → лендинг, authed → дашборд режимов) и то, что dev-заглушки с публичной
// главной ушли. Дуэль-API мокается, чтобы дашборд не ходил в сеть.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/api/duel", () => ({
  createRoom: vi.fn(),
  saveDuelSessionToken: vi.fn(),
}));

import HomePage from "../../src/pages/HomePage";
import { useAuthStore } from "../../src/store/authStore";

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, status: "anon" });
  });

  it("аноним видит лендинг с обоими CTA и требованиями", () => {
    renderHome();

    expect(screen.getByText("Дуэли по сборке кубика. Судит камера.")).toBeTruthy();
    // CTA «Создать аккаунт» намеренно двойной: в герое и в финальном блоке.
    expect(screen.getAllByRole("button", { name: "Создать аккаунт" }).length).toBe(2);
    expect(screen.getByRole("button", { name: "Попробовать соло без аккаунта" })).toBeTruthy();
    expect(screen.getByText(/Нужен компьютер с камерой/)).toBeTruthy();
  });

  it("грань кубика в герое — декоративная: 9 наклеек, скрыта от скринридера", () => {
    const { container } = renderHome();

    expect(screen.getAllByTestId("hero-sticker")).toHaveLength(9);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("аноним видит ссылки на правила и приватность", () => {
    renderHome();

    const rules = screen.getAllByRole("link", { name: /Правила/ });
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].getAttribute("href")).toBe("/rules");
    expect(
      screen.getByRole("link", { name: "Данные и приватность" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it("аноним не видит дашборд режимов под аккаунт", () => {
    renderHome();

    expect(screen.queryByRole("button", { name: /Дуэль по ссылке/ })).toBeNull();
    // Карточки-режимы ведут на регистрацию, а не в protected-роуты.
    expect(screen.queryByRole("link", { name: /Челлендж недели/ })?.getAttribute("href")).toBe(
      "/register",
    );
  });

  it("статус loading показывает лендинг, а не дашборд", () => {
    useAuthStore.setState({ user: null, status: "loading" });
    renderHome();

    expect(screen.getByText("Дуэли по сборке кубика. Судит камера.")).toBeTruthy();
  });

  it("авторизованный видит дашборд режимов", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    expect(screen.getByText("С чего начнём?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Дуэль по ссылке" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Челлендж недели/ }).getAttribute("href")).toBe(
      "/tournament",
    );
    expect(screen.getByRole("link", { name: /Скрамбл дня/ }).getAttribute("href")).toBe("/daily");
  });

  it("у каждого режима своя мини-сетка-индикатор", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    // Челлендж, скрамбл дня, дуэль.
    expect(screen.getAllByTestId("mini-grid")).toHaveLength(3);
  });

  it("dev-заглушек на главной больше нет", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    expect(screen.queryByRole("button", { name: "Недоступно" })).toBeNull();
    expect(screen.queryByText("0.00")).toBeNull();
  });
});
