// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBadges, type BadgeRead } from "../../src/api/badges";
import { ApiError } from "../../src/api/client";

function res(opts: { status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json === undefined ? "" : JSON.stringify(opts.json)),
  } as unknown as Response;
}

const BADGES: BadgeRead[] = [
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

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("badges api", () => {
  it("GET /badges returns full BadgeRead array with earned/locked flags", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BADGES }));
    const out = await getBadges();
    expect(out).toEqual(BADGES);
    expect(out.length).toBe(5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/badges");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("BadgeRead has code, title, description, icon, earned, earned_at", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BADGES }));
    const badges = await getBadges();
    const badge = badges[0];
    expect(badge).toHaveProperty("code");
    expect(badge).toHaveProperty("title");
    expect(badge).toHaveProperty("description");
    expect(badge).toHaveProperty("icon");
    expect(badge).toHaveProperty("earned");
    expect(badge).toHaveProperty("earned_at");
  });

  it("earned badge has earned=true and earned_at timestamp", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BADGES }));
    const badges = await getBadges();
    const earnedBadge = badges.find((b) => b.code === "sub_30");
    expect(earnedBadge?.earned).toBe(true);
    expect(earnedBadge?.earned_at).toBe("2026-07-19T12:00:00Z");
  });

  it("locked badge has earned=false and earned_at=null", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BADGES }));
    const badges = await getBadges();
    const lockedBadge = badges.find((b) => b.code === "first_duel_win");
    expect(lockedBadge?.earned).toBe(false);
    expect(lockedBadge?.earned_at).toBe(null);
  });

  it("401 (anon) on GET /badges surfaces as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 401, json: { detail: "Unauthorized" } }));
    const err = (await getBadges().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });
});
