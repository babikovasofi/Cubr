// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TournamentStandings from "../../src/tournament/TournamentStandings";
import type { TournamentStandingsRead } from "../../src/api/tournament";

const EMPTY_DATA: TournamentStandingsRead = {
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  entries: [],
  your_entry: null,
  valid_count: 0,
  dnf_count: 0,
};

const WITH_ENTRIES: TournamentStandingsRead = {
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  entries: [
    { display_name: "Alice", time_ms: 5000, is_self: false },
    { display_name: "Bob", time_ms: 3000, is_self: false },
    { display_name: "Charlie", time_ms: 7000, is_self: true },
  ],
  your_entry: { display_name: "Charlie", time_ms: 7000, is_self: true },
  valid_count: 3,
  dnf_count: 1,
};

describe("TournamentStandings", () => {
  it("renders de-ranked rows with NO rank number", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    // All rows rendered
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    // Charlie appears twice (entries + your_entry), so use getAllByText
    expect(screen.getAllByText("Charlie").length).toBeGreaterThan(0);

    // No rank/position numbers anywhere
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#1|#2|#3|rank|position/);
  });

  it("marks is_self row with 'ты' indicator", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    // Charlie appears in entries and your_entry sections
    const charlieElements = screen.getAllByText(/Charlie/);
    // At least one should have 'ты'
    expect(charlieElements.some((el) => el.closest("div")?.textContent?.includes("ты"))).toBe(true);

    // Alice row should not have 'ты'
    const aliceText = screen.getByText(/Alice/);
    const aliceRow = aliceText.closest("div");
    expect(aliceRow?.textContent).not.toMatch(/ты/);
  });

  it("renders empty state when entries is empty", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={EMPTY_DATA}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    expect(screen.getByText("Пока никто не закончил")).toBeTruthy();
  });

  it("renders DNF count line when dnf_count > 0", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    expect(screen.getByText("1 участник не финишировал")).toBeTruthy();
  });

  it("renders disclaimer text (дружеский зачёт)", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={EMPTY_DATA}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    expect(
      screen.getByText(/Время участники засекают сами — дружеский зачёт, не рейтинг/),
    ).toBeTruthy();
  });

  it("contains NO '@' character anywhere in output (privacy guard)", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/@/);
  });

  it("renders your_entry outside list when present", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    // Check for the "Твоё место" section
    expect(screen.getByText("Твоё место")).toBeTruthy();

    // The your_entry should be in a separate section
    const sections = screen.getAllByText(/Charlie/);
    expect(sections.length).toBeGreaterThan(1); // At least once in entries, once in your_entry
  });

  it("does not render your_entry section when your_entry is null", () => {
    const data: TournamentStandingsRead = {
      ...EMPTY_DATA,
      your_entry: null,
    };
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={data}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    expect(screen.queryByText("Твоё место")).toBeNull();
  });

  it("shows loading state", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={null}
        loading={true}
        error={null}
        reload={mockReload}
      />,
    );

    // The text appears in both visible and sr-only elements
    expect(screen.getAllByText("Загружаю таблицу…").length).toBeGreaterThan(0);
  });

  it("shows error state with retry button", () => {
    const mockReload = vi.fn();
    render(
      <TournamentStandings
        data={null}
        loading={false}
        error="Failed to load standings"
        reload={mockReload}
      />,
    );

    expect(screen.getByText("Failed to load standings")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Повторить" });
    expect(retryButton).toBeTruthy();

    retryButton?.click?.();
    expect(mockReload).toHaveBeenCalled();
  });

  it("formats times correctly (ms to seconds with 2 decimals)", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    // 5000 ms = 5.00 s, 3000 ms = 3.00 s, 7000 ms = 7.00 s
    // Some times appear in both the entries list and your_entry section
    expect(screen.getAllByText("5.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.00").length).toBeGreaterThan(0);
    // 7.00 appears twice (Charlie in entries and in your_entry)
    expect(screen.getAllByText("7.00").length).toBe(2);
  });

  it("renders week_label in header", () => {
    const mockReload = () => {};
    render(
      <TournamentStandings
        data={WITH_ENTRIES}
        loading={false}
        error={null}
        reload={mockReload}
      />,
    );

    expect(screen.getByText(/2026-W29/)).toBeTruthy();
  });
});
