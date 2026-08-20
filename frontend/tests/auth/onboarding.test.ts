import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasOnboarded, postLoginPath, syncOnboarded } from "../../src/auth/onboarding";
import type { UserRead } from "../../src/api/auth";

const markOnServer = vi.fn();
vi.mock("../../src/api/auth", () => ({
  markOnboardedOnServer: () => markOnServer(),
}));

// vitest runs in node (no DOM) — provide a minimal localStorage stub.
beforeEach(() => {
  markOnServer.mockReset();
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

/** По умолчанию аккаунт СТАРЫЙ — перенос к таким и адресован. */
function user(onboardedAt: string | null, createdAt = "2026-07-01T00:00:00Z"): UserRead {
  return { onboarded_at: onboardedAt, created_at: createdAt } as UserRead;
}

describe("postLoginPath", () => {
  it("returns a safe local next path", () => {
    expect(postLoginPath("/profile", null)).toBe("/profile");
    expect(postLoginPath("/solo?x=1", null)).toBe("/solo?x=1");
  });

  it("rejects open-redirect targets and falls back", () => {
    const done = user("2026-08-20T00:00:00Z");
    expect(postLoginPath("//evil.com", done)).toBe("/");
    expect(postLoginPath("https://evil.com", done)).toBe("/");
    expect(postLoginPath("http://evil.com", done)).toBe("/");
    expect(postLoginPath("javascript:alert(1)", done)).toBe("/");
  });

  // Решение принимает СЕРВЕРНЫЙ признак. Локальный флаг отвечал на вопрос
  // «показывали ли в этом браузере», из-за чего новый аккаунт в уже
  // использованном браузере онбординг пропускал (поймано 2026-08-20 на первом
  // входе через Google).
  it("ведёт по серверному признаку, а не по флагу браузера", () => {
    localStorage.setItem("cubr_onboarded", "1"); // чужой след в этом браузере
    expect(postLoginPath(null, user(null))).toBe("/onboarding");
    expect(postLoginPath(null, user("2026-08-20T00:00:00Z"))).toBe("/");
  });

  it("аноним без пользователя считается непрошедшим", () => {
    expect(postLoginPath(null, null)).toBe("/onboarding");
    expect(hasOnboarded(null)).toBe(false);
  });
});

describe("syncOnboarded — перенос старого локального флага", () => {
  it("отмечает на сервере того, кто проходил онбординг до серверного признака", async () => {
    localStorage.setItem("cubr_onboarded", "1");
    const stamped = user("2026-08-20T00:00:00Z");
    markOnServer.mockResolvedValue(stamped);

    expect(await syncOnboarded(user(null))).toBe(stamped);
    expect(markOnServer).toHaveBeenCalledTimes(1);
  });

  it("не трогает сервер, если локального следа нет", async () => {
    const fresh = user(null);
    expect(await syncOnboarded(fresh)).toBe(fresh);
    expect(markOnServer).not.toHaveBeenCalled();
  });

  it("не трогает сервер, если признак уже стоит", async () => {
    localStorage.setItem("cubr_onboarded", "1");
    const done = user("2026-08-20T00:00:00Z");
    expect(await syncOnboarded(done)).toBe(done);
    expect(markOnServer).not.toHaveBeenCalled();
  });

  // Тот самый баг, ради которого добавлена проверка возраста аккаунта.
  //
  // Флаг лежит в БРАУЗЕРЕ и не знает, чей он. Первая версия переноса
  // применяла его к любому загрузившемуся аккаунту, и первый же вход НОВЫМ
  // аккаунтом в браузере с чужим следом мгновенно получал «пройдено»
  // (поймано живьём 2026-08-20 на регистрации через Google).
  it("НЕ отмечает аккаунт, созданный уже после переезда признака на сервер", async () => {
    localStorage.setItem("cubr_onboarded", "1"); // чужой след в этом браузере
    const fresh = user(null, "2026-08-20T09:00:00Z");
    expect(await syncOnboarded(fresh)).toBe(fresh);
    expect(markOnServer).not.toHaveBeenCalled();
  });

  it("без даты создания перенос не делается — ошибаемся в безопасную сторону", async () => {
    localStorage.setItem("cubr_onboarded", "1");
    const unknown = { onboarded_at: null, created_at: null } as UserRead;
    expect(await syncOnboarded(unknown)).toBe(unknown);
    expect(markOnServer).not.toHaveBeenCalled();
  });

  // Перенос — удобство, а не условие входа: упавшая сеть не должна ронять
  // загрузку профиля.
  it("ошибка переноса не ломает вход", async () => {
    localStorage.setItem("cubr_onboarded", "1");
    markOnServer.mockRejectedValue(new Error("network"));
    const before = user(null);
    expect(await syncOnboarded(before)).toBe(before);
  });
});
