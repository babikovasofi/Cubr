// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EmptyState from "../../src/components/EmptyState";

describe("EmptyState", () => {
  it("рендерит title/description/CTA, когда переданы", () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="Пока пусто"
          description="Появится позже."
          ctaLabel="К соло-тренировке →"
          ctaTo="/solo"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Пока пусто")).toBeTruthy();
    expect(screen.getByText("Появится позже.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "К соло-тренировке →" });
    expect(link.getAttribute("href")).toBe("/solo");
  });

  it("без description и CTA рендерит только заголовок", () => {
    render(
      <MemoryRouter>
        <EmptyState title="Пока пусто" />
      </MemoryRouter>,
    );

    expect(screen.getByText("Пока пусто")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
