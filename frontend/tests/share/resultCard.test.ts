// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drawResultCard,
  renderCardBlob,
  resolvePalette,
  type CardData,
  type Ctx2D,
} from "../../src/share/resultCard";

function fakeCtx(): Ctx2D {
  return {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
  } as unknown as Ctx2D;
}

const SOLO_DATA: CardData = {
  kind: "solo",
  timeLabel: "12.34",
  dnf: false,
  scramble: "R U2 F' D L B2",
  dateLabel: "19.07.2026",
};

const DUEL_DATA: CardData = {
  kind: "duel",
  timeLabel: "12.34",
  dnf: false,
  scramble: "R U2 F' D L B2",
  dateLabel: "19.07.2026",
  duel: { outcome: "Ты выиграл", you: "12.34", opponent: "15.02" },
};

describe("resolvePalette", () => {
  it("falls back to default hex when a CSS var resolves empty (jsdom has no @import)", () => {
    const palette = resolvePalette();
    expect(palette.bg).not.toBe("");
    expect(palette.ink).not.toBe("");
    expect(palette.bg.startsWith("#")).toBe(true);
  });
});

describe("drawResultCard", () => {
  it("draws the time label, the scramble, and the Cubr wordmark for a solo card", () => {
    const ctx = fakeCtx();
    drawResultCard(ctx, SOLO_DATA, resolvePalette());
    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain("Cubr");
    expect(texts).toContain("12.34");
    expect(texts.some((t: string) => t.startsWith("R U2"))).toBe(true);
  });

  it("draws DNF instead of a numeric time when dnf is true", () => {
    const ctx = fakeCtx();
    drawResultCard(ctx, { ...SOLO_DATA, dnf: true }, resolvePalette());
    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain("DNF");
    expect(texts).not.toContain("12.34");
  });

  it("draws the outcome label and both time columns for a duel card, never a UUID", () => {
    const ctx = fakeCtx();
    drawResultCard(ctx, DUEL_DATA, resolvePalette());
    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain("Ты выиграл");
    expect(texts).toContain("12.34");
    expect(texts).toContain("15.02");
    const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(texts.some((t: string) => uuidLike.test(t))).toBe(false);
  });
});

describe("renderCardBlob", () => {
  const realCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a Blob", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "canvas") {
        (el as HTMLCanvasElement).getContext = vi.fn(() => fakeCtx()) as unknown as HTMLCanvasElement["getContext"];
        (el as HTMLCanvasElement).toBlob = (cb: BlobCallback) => cb(new Blob(["x"], { type: "image/png" }));
      }
      return el;
    });

    const blob = await renderCardBlob(SOLO_DATA);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("rejects with 'toBlob null' when toBlob yields null", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "canvas") {
        (el as HTMLCanvasElement).getContext = vi.fn(() => fakeCtx()) as unknown as HTMLCanvasElement["getContext"];
        (el as HTMLCanvasElement).toBlob = (cb: BlobCallback) => cb(null);
      }
      return el;
    });

    await expect(renderCardBlob(SOLO_DATA)).rejects.toThrow("toBlob null");
  });

  it("rejects when getContext returns null", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "canvas") {
        (el as HTMLCanvasElement).getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
      }
      return el;
    });

    await expect(renderCardBlob(SOLO_DATA)).rejects.toThrow();
  });
});
