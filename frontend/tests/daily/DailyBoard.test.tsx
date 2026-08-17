// @vitest-environment jsdom
// Mirrors tests/tournament/TournamentStandings.test.tsx.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DailyBoard from "../../src/daily/DailyBoard";
import type { DailyBoardRead } from "../../src/api/daily";

const EMPTY_DATA: DailyBoardRead = {
  date: "2026-07-19",
  day_label: "2026-07-19",
  event: "333",
  entries: [],
  your_entry: null,
  valid_count: 0,
  dnf_count: 0,
};

const WITH_ENTRIES: DailyBoardRead = {
  date: "2026-07-19",
  day_label: "2026-07-19",
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

describe("DailyBoard", () => {
  it("renders de-ranked rows with NO rank number", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getAllByText("Charlie").length).toBeGreaterThan(0);

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#1|#2|#3|rank|position/);
  });

  it("marks is_self row with 'ты' indicator", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    const charlieElements = screen.getAllByText(/Charlie/);
    expect(charlieElements.some((el) => el.closest("div")?.textContent?.includes("ты"))).toBe(true);

    const aliceText = screen.getByText(/Alice/);
    const aliceRow = aliceText.closest("div");
    expect(aliceRow?.textContent).not.toMatch(/ты/);
  });

  it("renders empty state when entries is empty", () => {
    const mockReload = () => {};
    render(<DailyBoard data={EMPTY_DATA} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText("Пока никто не закончил")).toBeTruthy();
  });

  it("renders DNF count line when dnf_count > 0", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText("1 участник не финишировал")).toBeTruthy();
  });

  it("renders «Кто уже собрал сегодня» heading (daily copy, not weekly)", () => {
    const mockReload = () => {};
    render(<DailyBoard data={EMPTY_DATA} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText("Кто уже собрал сегодня")).toBeTruthy();
  });

  it("contains NO '@' character anywhere in output (privacy guard)", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/@/);
  });

  it("renders your_entry outside list when present", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText("Твоё место")).toBeTruthy();
    const sections = screen.getAllByText(/Charlie/);
    expect(sections.length).toBeGreaterThan(1);
  });

  it("does not render your_entry section when your_entry is null", () => {
    const data: DailyBoardRead = { ...EMPTY_DATA, your_entry: null };
    const mockReload = () => {};
    render(<DailyBoard data={data} loading={false} error={null} reload={mockReload} />);

    expect(screen.queryByText("Твоё место")).toBeNull();
  });

  it("shows loading state", () => {
    const mockReload = () => {};
    render(<DailyBoard data={null} loading={true} error={null} reload={mockReload} />);

    expect(screen.getAllByText("Загружаю таблицу…").length).toBeGreaterThan(0);
  });

  it("shows error state with retry button", () => {
    const mockReload = vi.fn();
    render(
      <DailyBoard data={null} loading={false} error="Failed to load board" reload={mockReload} />,
    );

    expect(screen.getByText("Failed to load board")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Повторить" });
    expect(retryButton).toBeTruthy();

    retryButton?.click?.();
    expect(mockReload).toHaveBeenCalled();
  });

  it("formats times correctly (ms to seconds with 2 decimals)", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    expect(screen.getAllByText("5.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7.00").length).toBe(2);
  });

  it("renders day_label in header", () => {
    const mockReload = () => {};
    render(<DailyBoard data={WITH_ENTRIES} loading={false} error={null} reload={mockReload} />);

    expect(screen.getByText(/2026-07-19/)).toBeTruthy();
  });
});
