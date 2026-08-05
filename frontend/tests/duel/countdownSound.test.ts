// @vitest-environment node
//
// Core coverage of the Web Audio countdown-beep scheduler (plan:
// countdown-sounds). Full suite (mute persistence edge cases, unlock
// idempotency, DuelRoom wiring) is authored separately; this covers the
// scheduling/cleanup contract that's easy to get subtly wrong.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeSpyNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 0 },
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {};
  createOscillator = vi.fn(() => makeSpyNode());
  createGain = vi.fn(() => makeSpyNode());
}

let fakeCtx: FakeAudioContext;

beforeEach(() => {
  vi.resetModules();
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  fakeCtx = new FakeAudioContext();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  // `new Ctor()` requires a real constructible function — an arrow-based
  // vi.fn() throws "is not a constructor", so use a function expression.
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(function AudioContextCtor() {
    return fakeCtx;
  });
  vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { localStorage?: Storage }).localStorage;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe("scheduleCountdownBeeps", () => {
  it("schedules a tick per whole second plus one distinct go-tone", async () => {
    const { scheduleCountdownBeeps } = await import("../../src/duel/countdownSound");
    // 3.5s ahead (not an exact k boundary) so all 3 ticks clear the
    // `startAt - k > ctx.currentTime` skip-past guard unambiguously.
    const serverStartAt = new Date(Date.now() + 3_500).toISOString();

    const cleanup = scheduleCountdownBeeps(serverStartAt);

    // 3 ticks (k=1,2,3) + 1 go-tone
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(4);
    const oscCalls = fakeCtx.createOscillator.mock.results.map((r) => r.value);
    const startAt = fakeCtx.currentTime + 3.5;
    const ticks = oscCalls.slice(0, 3);
    const go = oscCalls[3];

    ticks.forEach((osc, i) => {
      expect(osc.frequency.value).toBe(1000);
      // pushed in k=1,2,3 order → when = startAt - k = startAt - (i+1)
      const expectedWhen = startAt - (i + 1);
      expect(osc.start).toHaveBeenCalledWith(expectedWhen);
    });
    expect(go.frequency.value).toBe(1760);
    expect(go.frequency.value).not.toBe(1000);
    expect(go.start).toHaveBeenCalledWith(startAt);

    cleanup();
  });

  it("returns a noop and schedules nothing when muted", async () => {
    const { scheduleCountdownBeeps, setCountdownMuted } = await import(
      "../../src/duel/countdownSound"
    );
    setCountdownMuted(true);
    const serverStartAt = new Date(Date.now() + 3_000).toISOString();

    scheduleCountdownBeeps(serverStartAt);

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled();
  });

  it("schedules nothing when serverStartAt is already in the past", async () => {
    const { scheduleCountdownBeeps } = await import("../../src/duel/countdownSound");
    const serverStartAt = new Date(Date.now() - 100).toISOString();

    scheduleCountdownBeeps(serverStartAt);

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled();
  });

  it("schedules nothing when the AudioContext is suspended", async () => {
    fakeCtx.state = "suspended";
    const { scheduleCountdownBeeps } = await import("../../src/duel/countdownSound");
    const serverStartAt = new Date(Date.now() + 3_000).toISOString();

    scheduleCountdownBeeps(serverStartAt);

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled();
  });

  it("no-ops without throwing when window has no AudioContext", async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const { scheduleCountdownBeeps, getAudioContext } = await import(
      "../../src/duel/countdownSound"
    );

    expect(getAudioContext()).toBeNull();
    expect(() => scheduleCountdownBeeps(new Date(Date.now() + 3_000).toISOString())).not.toThrow();
  });

  it("cleanup stops and disconnects every node, and is safe to call twice", async () => {
    const { scheduleCountdownBeeps } = await import("../../src/duel/countdownSound");
    const serverStartAt = new Date(Date.now() + 2_000).toISOString();

    const cleanup = scheduleCountdownBeeps(serverStartAt);
    const oscCalls = fakeCtx.createOscillator.mock.results.map((r) => r.value);
    const gainCalls = fakeCtx.createGain.mock.results.map((r) => r.value);
    expect(oscCalls.length).toBeGreaterThan(0);

    cleanup();
    // Each osc already got a scheduled stop() at schedule time (when + dur);
    // cleanup adds one immediate stop() on top — 2 calls total is correct.
    oscCalls.forEach((osc) => expect(osc.stop).toHaveBeenCalledTimes(2));
    gainCalls.forEach((gain) => expect(gain.disconnect).toHaveBeenCalledTimes(1));

    cleanup(); // second call must not stop/disconnect again
    oscCalls.forEach((osc) => expect(osc.stop).toHaveBeenCalledTimes(2));
    gainCalls.forEach((gain) => expect(gain.disconnect).toHaveBeenCalledTimes(1));
  });
});

describe("mute persistence", () => {
  it("defaults to unmuted; setCountdownMuted persists across reads", async () => {
    const { isCountdownMuted, setCountdownMuted } = await import("../../src/duel/countdownSound");
    expect(isCountdownMuted()).toBe(false);
    setCountdownMuted(true);
    expect(isCountdownMuted()).toBe(true);
    setCountdownMuted(false);
    expect(isCountdownMuted()).toBe(false);
  });

  it("guards a missing localStorage as a no-op default", async () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    const { isCountdownMuted, setCountdownMuted } = await import("../../src/duel/countdownSound");
    expect(() => setCountdownMuted(true)).not.toThrow();
    expect(isCountdownMuted()).toBe(false);
  });
});

describe("installAudioUnlock", () => {
  it("resumes the context once on the first gesture and is idempotent to install twice", async () => {
    (globalThis as unknown as { document: unknown }).document = globalThis;
    const listeners = new Map<string, () => void>();
    (globalThis as unknown as { addEventListener: unknown }).addEventListener = vi.fn(
      (type: string, listener: () => void) => listeners.set(type, listener)
    );
    fakeCtx.state = "suspended";
    const resume = vi.fn(() => Promise.resolve());
    (fakeCtx as unknown as { resume: unknown }).resume = resume;

    const { installAudioUnlock } = await import("../../src/duel/countdownSound");
    installAudioUnlock();
    installAudioUnlock(); // second call must not add duplicate listeners

    listeners.get("pointerdown")?.();
    expect(resume).toHaveBeenCalledTimes(1);

    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { addEventListener?: unknown }).addEventListener;
  });
});
