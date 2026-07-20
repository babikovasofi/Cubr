import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The store reads localStorage at module-eval time, so each test resets the
// storage + re-imports the module fresh (vi.resetModules) to exercise init.
describe("settingsStore", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to clock when nothing is stored", async () => {
    const { useSettingsStore } = await import("../../src/store/settingsStore");
    expect(useSettingsStore.getState().timeFormat).toBe("clock");
  });

  it("setTimeFormat updates state and persists to localStorage", async () => {
    const { useSettingsStore } = await import("../../src/store/settingsStore");
    useSettingsStore.getState().setTimeFormat("seconds");
    expect(useSettingsStore.getState().timeFormat).toBe("seconds");
    expect(store["cubr_time_format"]).toBe("seconds");
  });

  it("initialises from a persisted value", async () => {
    store["cubr_time_format"] = "seconds";
    const { useSettingsStore } = await import("../../src/store/settingsStore");
    expect(useSettingsStore.getState().timeFormat).toBe("seconds");
  });

  it("ignores a garbage stored value, falling back to clock", async () => {
    store["cubr_time_format"] = "nonsense";
    const { useSettingsStore } = await import("../../src/store/settingsStore");
    expect(useSettingsStore.getState().timeFormat).toBe("clock");
  });

  it("is a guarded no-op when localStorage is unavailable", async () => {
    vi.stubGlobal("localStorage", undefined);
    vi.resetModules();
    const { useSettingsStore } = await import("../../src/store/settingsStore");
    expect(useSettingsStore.getState().timeFormat).toBe("clock");
    expect(() => useSettingsStore.getState().setTimeFormat("seconds")).not.toThrow();
    expect(useSettingsStore.getState().timeFormat).toBe("seconds");
  });
});
