// @vitest-environment jsdom
//
// Обратная связь: два входа — карточка внизу главной и сквозная ссылка в
// футере. Оба ведут на один адрес письмом с подставленной темой; форма тут
// была бы ложной (бэкенда под неё нет).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IdeaBox, { FEEDBACK_EMAIL, feedbackMailto } from "../../src/components/IdeaBox";

afterEach(cleanup);

describe("IdeaBox", () => {
  it("даёт кнопку-письмо на адрес владельца с темой", () => {
    render(
      <MemoryRouter>
        <IdeaBox />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Написать письмо" });
    expect(link.getAttribute("href")).toBe(
      `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Cubr — идея или предложение")}`,
    );
  });

  it("показывает адрес текстом — его можно скопировать без почтовика", () => {
    render(
      <MemoryRouter>
        <IdeaBox />
      </MemoryRouter>,
    );
    expect(screen.getByText(FEEDBACK_EMAIL)).toBeTruthy();
  });

  it("кодирует тему письма", () => {
    expect(feedbackMailto("а б")).toBe(`mailto:${FEEDBACK_EMAIL}?subject=%D0%B0%20%D0%B1`);
  });
});
