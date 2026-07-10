import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postLoginPath } from "../../src/auth/onboarding";

// vitest runs in node (no DOM) — provide a minimal localStorage stub.
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("postLoginPath", () => {
  it("returns a safe local next path", () => {
    expect(postLoginPath("/profile")).toBe("/profile");
    expect(postLoginPath("/solo?x=1")).toBe("/solo?x=1");
  });

  it("rejects open-redirect targets and falls back", () => {
    localStorage.setItem("cubr_onboarded", "1"); // fallback = "/"
    expect(postLoginPath("//evil.com")).toBe("/");
    expect(postLoginPath("https://evil.com")).toBe("/");
    expect(postLoginPath("http://evil.com")).toBe("/");
    expect(postLoginPath("javascript:alert(1)")).toBe("/");
  });

  it("first-timer with no next goes to onboarding, returning user goes home", () => {
    expect(postLoginPath(null)).toBe("/onboarding");
    localStorage.setItem("cubr_onboarded", "1");
    expect(postLoginPath(null)).toBe("/");
  });
});
