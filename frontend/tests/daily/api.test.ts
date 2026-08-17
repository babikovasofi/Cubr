// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCurrentDaily,
  startDailyAttempt,
  submitDailyAttempt,
  getDailyBoard,
} from "../../src/api/daily";
import { ApiError } from "../../src/api/client";

function res(opts: { status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json === undefined ? "" : JSON.stringify(opts.json)),
  } as unknown as Response;
}

const CURRENT = {
  date: "2026-07-19",
  day_label: "2026-07-19",
  event: "333",
  attempt_status: null,
  time_ms: null,
  started_at: null,
  submitted_at: null,
  deadline_at: null,
};

const ATTEMPT = {
  id: "a1",
  daily_id: "d1",
  status: "started",
  honesty: "pending",
  time_ms: null,
  started_at: "2026-07-19T00:00:00Z",
  submitted_at: null,
  date: "2026-07-19",
  day_label: "2026-07-19",
  event: "333",
  scramble: "R U R' U'",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("daily api", () => {
  it("GET /daily/current hits the proxied /api path with credentials, no body", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: CURRENT }));
    const out = await getCurrentDaily();
    expect(out).toEqual(CURRENT);
    // NEVER a scramble field on this wire shape.
    expect(out).not.toHaveProperty("scramble");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/daily/current");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("401 (anon) on GET /daily/current surfaces as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 401, json: { detail: "Unauthorized" } }));
    const err = (await getCurrentDaily().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it("POST /daily/current/attempt/start sends no body and returns the scramble-bearing shape", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: ATTEMPT }));
    const out = await startDailyAttempt();
    expect(out).toEqual(ATTEMPT);
    expect(out.scramble).toBe("R U R' U'");
    // Daily has no badge engine — this shape never carries new_badges.
    expect(out).not.toHaveProperty("new_badges");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/daily/current/attempt/start");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("POST /daily/current/attempt/submit sends {time_ms,status} as JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 200, json: { ...ATTEMPT, status: "valid", time_ms: 12345 } }),
    );
    await submitDailyAttempt({ time_ms: 12345, status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/daily/current/attempt/submit");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ time_ms: 12345, status: "valid" });
  });

  it("409 on submit (already terminal) surfaces as ApiError with status 409", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 409, json: { detail: "Attempt already submitted" } }),
    );
    const err = (await submitDailyAttempt({ time_ms: 1, status: "dnf" }).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
  });

  it("network failure on submit surfaces as ApiError status 0 (retryable)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = (await submitDailyAttempt({ time_ms: 1, status: "valid" }).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("GET /daily/current/board hits the proxied /api path with credentials", async () => {
    const BOARD = {
      date: "2026-07-19",
      day_label: "2026-07-19",
      event: "333",
      entries: [],
      your_entry: null,
      valid_count: 0,
      dnf_count: 0,
    };
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BOARD }));
    const out = await getDailyBoard();
    expect(out).toEqual(BOARD);
    // No rank/scramble field on the board wire shape either.
    expect(out).not.toHaveProperty("scramble");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/daily/current/board");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("GET /daily/current/board forwards limit query param", async () => {
    const BOARD = {
      date: "2026-07-19",
      day_label: "2026-07-19",
      event: "333",
      entries: [],
      your_entry: null,
      valid_count: 0,
      dnf_count: 0,
    };
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: BOARD }));
    await getDailyBoard(50);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/daily/current/board?limit=50");
  });

  it("401 on GET /daily/current/board surfaces as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 401, json: { detail: "Unauthorized" } }));
    const err = (await getDailyBoard().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });
});
