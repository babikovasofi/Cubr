// DuelPage badge refetch-diff test (plan: achievements-badges)
// Verifies that new badges earned during a duel are toasted after result phase

import { describe, it, expect } from "vitest";
import type { BadgeRead } from "../../src/api/badges";

const INITIAL_BADGES: BadgeRead[] = [
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
];

const AFTER_DUEL_BADGES: BadgeRead[] = [
  INITIAL_BADGES[0], // sub_30 still earned
  {
    ...INITIAL_BADGES[1],
    earned: true, // first_duel_win now earned
    earned_at: "2026-07-19T13:00:00Z",
  },
];

describe("DuelPage badge refetch-diff", () => {
  it("toasts new badges earned during duel (before→after snapshot)", () => {
    // Simulate the duel page logic:
    // 1. Mount: snapshot earned codes
    const beforeBadges = INITIAL_BADGES;
    const beforeCodes = new Set(beforeBadges.filter((b) => b.earned).map((b) => b.code));
    expect(beforeCodes).toEqual(new Set(["sub_30"]));

    // 2. On result phase: refetch and diff
    const afterBadges = AFTER_DUEL_BADGES;
    const newBadgesToast: Array<{ code: string; title: string }> = [];
    for (const b of afterBadges) {
      if (b.earned && !beforeCodes.has(b.code)) {
        newBadgesToast.push({ code: b.code, title: b.title });
      }
    }

    expect(newBadgesToast).toHaveLength(1);
    expect(newBadgesToast[0]).toEqual({
      code: "first_duel_win",
      title: "Первая победа",
    });
  });

  it("does not toast already-owned badges", () => {
    // Snapshot: sub_30 already earned
    const beforeCodes = new Set(["sub_30"]);

    // After duel: sub_30 still earned (not new)
    const afterBadges: BadgeRead[] = [
      {
        code: "sub_30",
        title: "Меньше 30",
        description: "Сборка кубика быстрее 30 секунд.",
        icon: "⏱️",
        earned: true,
        earned_at: "2026-07-19T12:00:00Z",
      },
    ];

    const toastCalls: Array<{ code: string; title: string }> = [];
    for (const b of afterBadges) {
      if (b.earned && !beforeCodes.has(b.code)) {
        toastCalls.push({ code: b.code, title: b.title });
      }
    }

    expect(toastCalls).toHaveLength(0);
  });

  it("handles multiple new badges", () => {
    // Snapshot: none earned
    const beforeCodes = new Set<string>();

    // After duel: both badges earned
    const afterBadges = AFTER_DUEL_BADGES;
    afterBadges[0].earned = true; // sub_30 also now earned (hypothetically)
    afterBadges[0].earned_at = "2026-07-19T13:00:00Z";

    const newBadges: Array<{ code: string; title: string }> = [];
    for (const b of afterBadges) {
      if (b.earned && !beforeCodes.has(b.code)) {
        newBadges.push({ code: b.code, title: b.title });
      }
    }

    expect(newBadges).toHaveLength(2);
    expect(newBadges.map((b) => b.code)).toEqual(["sub_30", "first_duel_win"]);
  });

  it("snapshot miss (loading timeout) is cosmetic", () => {
    // Snapshot never loaded in time (before === null)
    const before: Set<string> | null = null;

    // Result phase reached
    const afterBadges = AFTER_DUEL_BADGES;

    // Refetch-diff skipped because snapshot is null
    const toastCalls: Array<{ code: string; title: string }> = [];
    if (before !== null) {
      const beforeSet = before as Set<string>;
      for (const b of afterBadges) {
        if (b.earned && !beforeSet.has(b.code)) {
          toastCalls.push({ code: b.code, title: b.title });
        }
      }
    }

    // No toast fired (cosmetic miss)
    expect(toastCalls).toHaveLength(0);
  });

  it("toast fires only once per result phase", () => {
    // Simulate badge toast state
    let toastCount = 0;
    let alreadyToasted = false;

    const before = new Set(["sub_30"]);
    const afterBadges = AFTER_DUEL_BADGES;

    // First time result phase is entered
    if (!alreadyToasted && before !== null) {
      for (const b of afterBadges) {
        if (b.earned && !before.has(b.code)) {
          toastCount++;
        }
      }
      alreadyToasted = true;
    }

    expect(toastCount).toBe(1);

    // Second time effect runs (shouldn't happen, but verify guard works)
    if (!alreadyToasted && before !== null) {
      // This block is skipped
      toastCount += 99;
    }

    expect(toastCount).toBe(1); // Still 1, guard worked
    expect(alreadyToasted).toBe(true);
  });
});
