import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAuthStore, isAuthed, __resetBootstrapForTests } from "../../src/store/authStore";

function res(status: number, json?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => (json === undefined ? "" : JSON.stringify(json)),
  } as unknown as Response;
}

const fetchMock = vi.fn();

const USER = {
  id: "u1",
  email: "a@b.com",
  is_active: true,
  is_superuser: false,
  is_verified: true,
  handle: "neo",
  avatar_url: null,
  cups: 3,
  best_single_ms: 12340,
  best_ao5_ms: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useAuthStore.setState({ user: null, status: "loading" });
  __resetBootstrapForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("authStore.bootstrap()", () => {
  it("starts in loading and becomes authed when /users/me returns 200", async () => {
    expect(useAuthStore.getState().status).toBe("loading");
    fetchMock.mockResolvedValueOnce(res(200, USER));

    await useAuthStore.getState().bootstrap();

    const s = useAuthStore.getState();
    expect(s.status).toBe("authed");
    expect(s.user?.email).toBe("a@b.com");
    expect(isAuthed()).toBe(true);
  });

  it("becomes anon on 401 without throwing (401 is the normal anon path)", async () => {
    fetchMock.mockResolvedValueOnce(res(401, { detail: "Unauthorized" }));

    await expect(useAuthStore.getState().bootstrap()).resolves.toBeUndefined();

    const s = useAuthStore.getState();
    expect(s.status).toBe("anon");
    expect(s.user).toBeNull();
    expect(isAuthed()).toBe(false);
  });

  it("only probes once even if called twice", async () => {
    fetchMock.mockResolvedValueOnce(res(200, USER));
    await useAuthStore.getState().bootstrap();
    await useAuthStore.getState().bootstrap();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("authStore.login()", () => {
  it("logs in (204) then loads the user -> authed", async () => {
    fetchMock
      .mockResolvedValueOnce(res(204)) // POST /auth/login
      .mockResolvedValueOnce(res(200, USER)); // GET /users/me

    await useAuthStore.getState().login("a@b.com", "secret");

    expect(useAuthStore.getState().status).toBe("authed");
    expect(useAuthStore.getState().user?.handle).toBe("neo");
  });
});
