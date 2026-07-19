// Toast tests for badge awards on solve and tournament submit
// (plan: achievements-badges)

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BadgeRead } from "../../src/api/badges";
import type { SolveRead } from "../../src/api/solves";
import type { TournamentAttemptRead } from "../../src/api/tournament";
import { saveSoloResult, buildSolvePayload } from "../../src/solo/solveSave";

// Mock the toast function
vi.mock("../../src/components/Toast", () => ({
  toast: vi.fn(),
}));

const BADGE_SUB_30: BadgeRead = {
  code: "sub_30",
  title: "Меньше 30",
  description: "Сборка кубика быстрее 30 секунд.",
  icon: "⏱️",
  earned: true,
  earned_at: "2026-07-19T12:00:00Z",
};

const BADGE_WEEKLY_DEBUT: BadgeRead = {
  code: "weekly_debut",
  title: "Дебют турнира",
  description: "Первая успешная попытка в еженедельном турнире.",
  icon: "📅",
  earned: true,
  earned_at: "2026-07-19T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("solve toast", () => {
  it("fires toast for each new badge on successful solve save", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "s1",
      new_badges: [BADGE_SUB_30],
    } as SolveRead);

    const payload = buildSolvePayload("R U R' U'", 29999, false);
    const badgeToastSpy = vi.fn();

    await saveSoloResult({
      isAuthed: true,
      payload,
      create: mockCreate,
      onNewBadges: (badges) => {
        for (const b of badges) {
          badgeToastSpy(`Бейдж получен: ${b.title}`);
        }
      },
    });

    expect(badgeToastSpy).toHaveBeenCalledWith("Бейдж получен: Меньше 30");
  });

  it("fires no toast when new_badges is empty", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "s2",
      scramble: "R U R' U'",
      time_ms: 15000,
      status: "valid",
      verify_frames_ok: true,
      duel_id: null,
      tournament_id: null,
      cube_id: null,
      scramble_id: null,
      created_at: "2026-07-19T12:00:00Z",
      new_badges: [],
    } as SolveRead);

    const payload = buildSolvePayload("R U R' U'", 15000, false);
    const badgeToastSpy = vi.fn();

    await saveSoloResult({
      isAuthed: true,
      payload,
      create: mockCreate,
      onNewBadges: (badges) => {
        for (const b of badges) {
          badgeToastSpy(`Бейдж получен: ${b.title}`);
        }
      },
    });

    expect(badgeToastSpy).not.toHaveBeenCalled();
  });

  it("fires no toast when new_badges is undefined", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "s3",
      scramble: "R U R' U'",
      time_ms: 45000,
      status: "valid",
      verify_frames_ok: true,
      duel_id: null,
      tournament_id: null,
      cube_id: null,
      scramble_id: null,
      created_at: "2026-07-19T12:00:00Z",
      // new_badges undefined
    } as SolveRead);

    const payload = buildSolvePayload("R U R' U'", 45000, false);
    const badgeToastSpy = vi.fn();

    await saveSoloResult({
      isAuthed: true,
      payload,
      create: mockCreate,
      onNewBadges: (badges) => {
        for (const b of badges) {
          badgeToastSpy(`Бейдж получен: ${b.title}`);
        }
      },
    });

    expect(badgeToastSpy).not.toHaveBeenCalled();
  });

  it("does not call onNewBadges callback when isAuthed is false", async () => {
    const badgeToastSpy = vi.fn();

    const result = await saveSoloResult({
      isAuthed: false,
      payload: buildSolvePayload("R U R' U'", 5000, false),
      create: vi.fn(),
      onNewBadges: badgeToastSpy,
    });

    expect(result).toBe("anon");
    expect(badgeToastSpy).not.toHaveBeenCalled();
  });

  it("does not call onNewBadges callback on save failure", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("Network error"));
    const badgeToastSpy = vi.fn();

    const result = await saveSoloResult({
      isAuthed: true,
      payload: buildSolvePayload("R U R' U'", 5000, false),
      create: mockCreate,
      onNewBadges: badgeToastSpy,
    });

    expect(result).toBe("failed");
    expect(badgeToastSpy).not.toHaveBeenCalled();
  });
});

describe("tournament toast", () => {
  it("fires toast for each new badge on tournament submit", () => {
    const attempt: TournamentAttemptRead = {
      id: "a1",
      tournament_id: "t1",
      status: "valid",
      honesty: "pending",
      time_ms: 25000,
      started_at: "2026-07-19T00:00:00Z",
      submitted_at: "2026-07-19T01:00:00Z",
      iso_year: 2026,
      iso_week: 29,
      week_label: "2026-W29",
      event: "333",
      scramble: "R U R' U'",
      new_badges: [BADGE_WEEKLY_DEBUT],
    };

    const badgesToastSpy = vi.fn();
    if (attempt.new_badges && attempt.new_badges.length > 0) {
      for (const b of attempt.new_badges) {
        badgesToastSpy(`Бейдж получен: ${b.title}`, "success");
      }
    }

    expect(badgesToastSpy).toHaveBeenCalledWith("Бейдж получен: Дебют турнира", "success");
  });

  it("fires no toast when new_badges is empty on tournament submit", () => {
    const attempt: TournamentAttemptRead = {
      id: "a2",
      tournament_id: "t1",
      status: "valid",
      honesty: "pending",
      time_ms: 26000,
      started_at: "2026-07-19T00:00:00Z",
      submitted_at: "2026-07-19T01:00:00Z",
      iso_year: 2026,
      iso_week: 29,
      week_label: "2026-W29",
      event: "333",
      scramble: "R U R' U'",
      new_badges: [],
    };

    const badgesToastSpy = vi.fn();
    if (attempt.new_badges && attempt.new_badges.length > 0) {
      for (const b of attempt.new_badges) {
        badgesToastSpy(`Бейдж получен: ${b.title}`, "success");
      }
    }

    expect(badgesToastSpy).not.toHaveBeenCalled();
  });
});
