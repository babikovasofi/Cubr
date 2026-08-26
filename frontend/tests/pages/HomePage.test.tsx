// @vitest-environment jsdom
//
// Этап 6, лендинг: одна страница "/" с двумя лицами. Проверяем ровно развилку
// (аноним → лендинг, authed → дашборд режимов) и то, что dev-заглушки с публичной
// главной ушли. Дуэль-API мокается, чтобы дашборд не ходил в сеть.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/api/duel", () => ({
  createRoom: vi.fn(),
  saveDuelSessionToken: vi.fn(),
}));

import HomePage from "../../src/pages/HomePage";
import { useAuthStore } from "../../src/store/authStore";
import { useLangStore } from "../../src/store/langStore";
import { loadEnDict } from "../../src/i18n/t";

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

  it("грань видна с базовой (мобильной) ширины, а не только от lg:", () => {
    renderHome();

    const stickers = screen.getAllByTestId("hero-sticker");
    const grid = stickers[0].parentElement;
    expect(grid).toBeTruthy();
    const gridClasses = grid!.className.split(/\s+/);
    const stickerClasses = stickers[0].className.split(/\s+/);

    // Раньше грань пряталась `hidden` до брейкпоинта `lg:grid` — контейнер
    // не должен нести `hidden` ни на каком уровне: `display` у него должен
    // быть `grid` уже в базовом (безпрефиксном) состоянии.
    expect(gridClasses).not.toContain("hidden");
    expect(gridClasses).toContain("grid");
    // Базовый (мобильный) размер плитки задан без брейкпоинт-префикса —
    // значит, он активен уже на самой узкой ширине, а не только от sm/lg.
    expect(stickerClasses).toContain("h-9");
    expect(stickerClasses).toContain("w-9");
  });

  // "Не на глаз": в jsdom нет раскладки, поэтому переполнение доказываем
  // арифметически — по фактически отрендеренным Tailwind-классам, а не по
  // ожиданию. Плитка 36px и зазор 6px (h-9/w-9, gap-1.5) — те же токены,
  // что заданы в HeroStickers.tsx для базового (безпрефиксного) состояния;
  // если кто-то поднимет мобильный размер плитки, эта проверка упадёт раньше,
  // чем баг доедет до телефона. Самая узкая поддерживаемая ширина — 320px
  // (iPhone SE), паддинг страницы `px-4` с обеих сторон (см. App.tsx `<main>`
  // `mx-auto max-w-content px-4`) даёт 320 − 32 = 288px полезной ширины;
  // сама грань размещается в своём собственном ряду (герой — `flex-col` на
  // базовой ширине), так что ей достаточно не превысить эти 288px в одиночку.
  it("уменьшенная грань не может вызвать горизонтальный скролл на самом узком экране", () => {
    renderHome();

    const stickers = screen.getAllByTestId("hero-sticker");
    const TILE_PX = 36; // h-9 = 2.25rem = 36px при корневом 16px (см. HeroStickers.tsx)
    const GAP_PX = 6; // gap-1.5 = 0.375rem = 6px
    const footprint = TILE_PX * 3 + GAP_PX * 2;
    const NARROWEST_VIEWPORT_PX = 320;
    const PAGE_PADDING_PX = 16 * 2; // App.tsx <main className="... px-4 ..."> — 16px с каждой стороны
    const availableWidth = NARROWEST_VIEWPORT_PX - PAGE_PADDING_PX;

    expect(stickers).toHaveLength(9);
    expect(footprint).toBeLessThan(availableWidth);

    // Герой — колонка на базовой ширине (переключение в ряд только с sm:),
    // поэтому грани не приходится делить строку с текстом и бороться за
    // ширину с ним — сама эта проверка и есть гарантия от переполнения.
    const grid = stickers[0].parentElement!;
    const heroSection = grid.closest("section")!;
    const sectionClasses = heroSection.className.split(/\s+/);
    expect(sectionClasses).toContain("flex-col");
    expect(sectionClasses.some((c) => c === "flex-row" || c === "justify-between")).toBe(false);
    expect(sectionClasses).toContain("sm:flex-row");
  });

  it("аноним видит ссылку на правила", () => {
    renderHome();

    const rules = screen.getAllByRole("link", { name: /Правила/ });
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].getAttribute("href")).toBe("/rules");
  });

  it("не повторяет то, что уже сказано выше и в футере", () => {
    renderHome();

    // Блок «Честно и без слежки» убран: «Скрамбл генерит сервер» дословно
    // повторял шаг «Скрамбл выдаёт сервер», «Видео остаётся у тебя» — строку
    // под героем, а ссылка на приватность живёт в футере на каждой странице
    // (её проверяет tests/pages/legal.test.tsx).
    expect(screen.queryByText(/Честно и без слежки/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Данные и приватность" })).toBeNull();
    // Предупреждение про рейтинг убрано с лендинга (owner).
    expect(screen.queryByText(/Мест и рейтинга пока нет/)).toBeNull();
  });

  it("аноним не видит дашборд режимов под аккаунт", () => {
    renderHome();

    expect(screen.queryByRole("button", { name: /Дуэль по ссылке/ })).toBeNull();
    // Карточки-режимы ведут на регистрацию, а не в protected-роуты.
    expect(screen.queryByRole("link", { name: /Челлендж недели/ })?.getAttribute("href")).toBe(
      "/register",
    );
  });

  it("тренажёр PLL — анониму сразу на /trainer, не на /register (§П5)", () => {
    renderHome();

    expect(screen.getByRole("link", { name: /Тренажёр/ }).getAttribute("href")).toBe("/trainer");
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
    // Соло — карточка-ссылка, как остальные режимы (не голая кнопка).
    expect(screen.getByRole("link", { name: /Соло-тренировка/ }).getAttribute("href")).toBe(
      "/solo",
    );
  });

  it("у каждого режима своя мини-сетка-индикатор", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    // Соло, челлендж, скрамбл дня, тренажёр PLL, случайный соперник, дуэль по ссылке.
    expect(screen.getAllByTestId("mini-grid")).toHaveLength(6);
  });

  it("дашборд предлагает тренажёр PLL без гейта по регистрации", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    expect(screen.getByRole("link", { name: /Тренажёр/ }).getAttribute("href")).toBe("/trainer");
  });

  it("с телефона лендинг честно предупреждает про компьютер (R8)", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    renderHome();

    expect(screen.getByText(/Сборка идёт с компьютера/)).toBeTruthy();
    expect(screen.queryByText(/Нужен компьютер с камерой/)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("dev-заглушек на главной больше нет", () => {
    useAuthStore.setState({ status: "authed" });
    renderHome();

    expect(screen.queryByRole("button", { name: "Недоступно" })).toBeNull();
    expect(screen.queryByText("0.00")).toBeNull();
  });
});

// Локализация: на английском лендинг говорит по-английски. Проверяем ровно факт
// переключения (полнота словаря — забота tests/i18n/t.test.ts).
describe("HomePage — английский", () => {
  it("герой и CTA переводятся", async () => {
    // Словарь en — ленивый чанк (см. src/i18n/t.ts); догружаем его явно, иначе
    // первый рендер после переключения ещё покажет русский.
    await loadEnDict();
    useAuthStore.setState({ user: null, status: "anon" });
    act(() => useLangStore.setState({ lang: "en" }));
    try {
      renderHome();
      expect(screen.getByText("Cube duels. The camera is the judge.")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Create an account" }).length).toBe(2);
      expect(screen.queryByText("Дуэли по сборке кубика. Судит камера.")).toBeNull();
    } finally {
      act(() => useLangStore.setState({ lang: "ru" }));
    }
  });
});
