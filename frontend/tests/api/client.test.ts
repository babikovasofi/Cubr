import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { request, ApiError, parseErrorBody } from "../../src/api/client";
import { login } from "../../src/api/auth";

// Minimal fetch Response stub covering what client.ts touches.
function res(opts: {
  ok?: boolean;
  status: number;
  json?: unknown;
  jsonThrows?: boolean;
  text?: string;
}): Response {
  return {
    ok: opts.ok ?? (opts.status >= 200 && opts.status < 300),
    status: opts.status,
    json: async () => {
      if (opts.jsonThrows) throw new Error("no json");
      return opts.json;
    },
    text: async () => opts.text ?? "",
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseErrorBody — fastapi-users detail shapes", () => {
  it("maps a bare-string detail code to RU", () => {
    expect(parseErrorBody(400, { detail: "LOGIN_BAD_CREDENTIALS" })).toEqual({
      code: "LOGIN_BAD_CREDENTIALS",
      message: "Неверная почта или пароль.",
    });
  });

  it("maps an object {code,reason} detail to RU (never [object Object])", () => {
    const out = parseErrorBody(400, {
      detail: { code: "REGISTER_INVALID_PASSWORD", reason: "too short" },
    });
    expect(out.code).toBe("REGISTER_INVALID_PASSWORD");
    expect(out.message).toBe("Пароль слишком простой. Минимум 8 символов.");
    expect(out.message).not.toContain("object Object");
  });

  it.each([
    ["LOGIN_USER_NOT_VERIFIED"],
    ["REGISTER_USER_ALREADY_EXISTS"],
    ["RESET_PASSWORD_BAD_TOKEN"],
    ["VERIFY_USER_BAD_TOKEN"],
  ])("has a RU message for %s", (code) => {
    const out = parseErrorBody(400, { detail: code });
    expect(out.code).toBe(code);
    expect(out.message.length).toBeGreaterThan(0);
    expect(out.message).not.toMatch(/object Object|undefined/);
  });

  // Этап 6, фильтр имён: бэк отдаёт 400 c `detail: {code, reason}` (НЕ pydantic-422,
  // тот схлопнулся бы в общее «что-то пошло не так»). Текст берём свой, не серверный.
  it.each([
    ["NAME_NOT_ALLOWED", "Такое имя не подходит. Выбери другое."],
    ["NAME_RESERVED", "Это имя зарезервировано за сервисом. Выбери другое."],
    ["NAME_TOO_SHORT", "Имя слишком короткое: минимум 2 символа."],
  ])("объясняет отказ фильтра имён: %s", (code, message) => {
    const out = parseErrorBody(400, { detail: { code, reason: "server copy" } });
    expect(out.code).toBe(code);
    expect(out.message).toBe(message);
  });

  it("maps 429 by status when there is no usable detail", () => {
    const out = parseErrorBody(429, null);
    expect(out.message).toBe("Слишком много попыток. Подожди немного и попробуй снова.");
  });

  it("falls back to a reason string, then to a generic RU message", () => {
    expect(parseErrorBody(400, { detail: { reason: "тест" } }).message).toBe("тест");
    expect(parseErrorBody(418, {}).message).toBe("Что-то пошло не так. Попробуй ещё раз.");
  });

  // Живой прогон: бэкенд не запущен → dev-прокси отвечает 502, fetch НЕ падает,
  // и пользователь видел общее «Что-то пошло не так» — неотличимо от «пароль
  // слишком простой». Статусы недоступности объясняются отдельно.
  it("explains an unreachable/broken server instead of the generic message", () => {
    expect(parseErrorBody(502, null).message).toBe(
      "Сервер сейчас недоступен. Попробуй через минуту.",
    );
    expect(parseErrorBody(503, null).message).toBe(
      "Сервер сейчас недоступен. Попробуй через минуту.",
    );
    expect(parseErrorBody(504, null).message).toBe("Сервер не ответил вовремя. Попробуй ещё раз.");
    expect(parseErrorBody(500, {}).message).toBe("Ошибка на сервере. Попробуй ещё раз чуть позже.");
  });
});

describe("request()", () => {
  it("throws ApiError with mapped code+message on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 400, json: { detail: "LOGIN_BAD_CREDENTIALS" } }),
    );
    await expect(request("/auth/login", { json: {} })).rejects.toMatchObject({
      status: 400,
      code: "LOGIN_BAD_CREDENTIALS",
      message: "Неверная почта или пароль.",
    });
  });

  it("maps a 429 with no JSON body", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 429, jsonThrows: true }));
    const err = (await request("/auth/register", { json: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.message).toContain("Слишком много попыток");
  });

  it("returns undefined for 204 and never parses the body", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));
    await expect(request("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("wraps a network failure as ApiError status 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = (await request("/users/me").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("sends credentials:include and JSON content-type", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, text: JSON.stringify({ ok: true }) }));
    await request("/users/me", { json: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("login — form-urlencoded with username field", () => {
  it("posts application/x-www-form-urlencoded with username=email (not JSON)", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));
    await login("a@b.com", "secret123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // Body must be urlencoded, not JSON.
    expect(init.body).not.toContain("{");
    const parsed = new URLSearchParams(init.body as string);
    expect(parsed.get("username")).toBe("a@b.com");
    expect(parsed.get("password")).toBe("secret123");
    expect(parsed.get("email")).toBeNull();
  });
});
