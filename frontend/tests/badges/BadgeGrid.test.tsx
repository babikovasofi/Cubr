// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { BadgeRead } from "../../src/api/badges";

// Mock before importing the component
vi.mock("../../src/api/badges", () => ({
  getBadges: vi.fn(),
}));

import BadgeGrid from "../../src/components/BadgeGrid";
import { getBadges } from "../../src/api/badges";

const EARNED_BADGES: BadgeRead[] = [
  {
    code: "sub_30",
    title: "Меньше 30",
    description: "Сборка кубика быстрее 30 секунд.",
    icon: "⏱️",
    earned: true,
    earned_at: "2026-07-19T12:00:00Z",
  },
  {
    code: "first_duel_win",
    title: "Первая победа",
    description: "Победа в дуэли.",
    icon: "🥇",
    earned: false,
    earned_at: null,
  },
  {
    code: "ten_duels",
    title: "Ветеран дуэлей",
    description: "10 завершённых дуэлей.",
    icon: "🔟",
    earned: false,
    earned_at: null,
  },
  {
    code: "giant_slayer",
    title: "Гроза авторитетов",
    description: "Победа над соперником с лучшим личным рекордом.",
    icon: "⚔️",
    earned: false,
    earned_at: null,
  },
  {
    code: "weekly_debut",
    title: "Дебют турнира",
    description: "Первая успешная попытка в еженедельном турнире.",
    icon: "📅",
    earned: false,
    earned_at: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BadgeGrid", () => {
  it("renders loading state initially", () => {
    vi.mocked(getBadges).mockReturnValue(
      new Promise(() => {}),
    );
    render(<BadgeGrid />);
    const loadingTexts = screen.getAllByText(/Загружаю бейджи/);
    expect(loadingTexts.length).toBeGreaterThan(0);
  });

  it("renders all badges when loaded", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    render(<BadgeGrid />);
    await waitFor(() => {
      expect(screen.getByText("Меньше 30")).toBeTruthy();
      expect(screen.getByText("Первая победа")).toBeTruthy();
      expect(screen.getByText("Ветеран дуэлей")).toBeTruthy();
      expect(screen.getByText("Гроза авторитетов")).toBeTruthy();
      expect(screen.getByText("Дебют турнира")).toBeTruthy();
    });
  });

  it("renders earned badge with title, icon, description, earned_at", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    render(<BadgeGrid />);
    await waitFor(() => {
      const sub30Title = screen.getByText("Меньше 30");
      expect(sub30Title).toBeTruthy();
      const sub30Card = sub30Title.closest("[class*='flex flex-col']");
      expect(sub30Card?.textContent).toContain("⏱️");
      expect(sub30Card?.textContent).toContain("Сборка кубика быстрее 30 секунд.");
      // earned_at should be shown
      expect(sub30Card?.textContent).toMatch(/Получен/);
    });
  });

  it("renders locked badge dimmed (opacity-40)", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    const { container } = render(<BadgeGrid />);
    await waitFor(() => {
      const lockedBadges = container.querySelectorAll(".opacity-40");
      // 4 locked badges (all except sub_30)
      expect(lockedBadges.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("renders earned badge without dimming (no opacity-40)", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    const { container } = render(<BadgeGrid />);
    await waitFor(() => {
      const allBadgeCards = container.querySelectorAll("[aria-label='Бейджи'] > div");
      // Find the first one (earned sub_30)
      const earnedCard = allBadgeCards[0];
      expect(earnedCard?.textContent).toContain("Меньше 30");
      expect(earnedCard?.className).not.toContain("opacity-40");
    });
  });

  it("shows earned_at date only for earned badges", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    render(<BadgeGrid />);
    await waitFor(() => {
      // sub_30 should show "Получен"
      const earned = screen.getByText(/Получен/);
      expect(earned).toBeTruthy();
      const earnedRow = earned.closest("div");
      expect(earnedRow?.textContent).toContain("Меньше 30");
    });
  });

  it("renders error state with retry button", async () => {
    vi.mocked(getBadges).mockRejectedValue(
      new Error("Network error"),
    );
    render(<BadgeGrid />);
    await waitFor(() => {
      expect(screen.getByText(/Не удалось загрузить бейджи/)).toBeTruthy();
      expect(screen.getByText("Повторить")).toBeTruthy();
    });
  });

  it("grid has proper aria-label", async () => {
    vi.mocked(getBadges).mockResolvedValue(EARNED_BADGES);
    render(<BadgeGrid />);
    await waitFor(() => {
      const grid = screen.getByLabelText("Бейджи");
      expect(grid).toBeTruthy();
      expect(grid.children.length).toBe(5);
    });
  });
});
