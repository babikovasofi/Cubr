// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCurrent, startAttempt, submitAttempt, getStandings } from "../../src/api/tournament";
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
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  attempt_status: null,
  time_ms: null,
  started_at: null,
  submitted_at: null,
  deadline_at: null,
};

const ATTEMPT = {
  id: "a1",
  tournament_id: "t1",
  status: "started",
  honesty: "pending",
  time_ms: null,
  started_at: "2026-07-17T00:00:00Z",
  submitted_at: null,
  iso_year: 2026,
  iso_week: 29,
  week_label: "2026-W29",
  event: "333",
  scramble: "R U R' U'",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("tournament api", () => {
  it("GET /tournament/current hits the proxied /api path with credentials, no body", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: CURRENT }));
    const out = await getCurrent();
    expect(out).toEqual(CURRENT);
    // NEVER a scramble field on this wire shape.
    expect(out).not.toHaveProperty("scramble");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tournament/current");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("401 (anon) on GET /tournament/current surfaces as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 401, json: { detail: "Unauthorized" } }));
    const err = (await getCurrent().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it("POST /tournament/current/attempt/start sends no body and returns the scramble-bearing shape", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: ATTEMPT }));
    const out = await startAttempt();
    expect(out).toEqual(ATTEMPT);
    expect(out.scramble).toBe("R U R' U'");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tournament/current/attempt/start");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("POST /tournament/current/attempt/submit sends {time_ms,status} as JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 200, json: { ...ATTEMPT, status: "valid", time_ms: 12345 } }),
    );
    await submitAttempt({ time_ms: 12345, status: "valid" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tournament/current/attempt/submit");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ time_ms: 12345, status: "valid" });
  });

  it("409 on submit (already terminal) surfaces as ApiError with status 409", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 409, json: { detail: "Attempt already submitted" } }),
    );
    const err = (await submitAttempt({ time_ms: 1, status: "dnf" }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
  });

  it("network failure on submit surfaces as ApiError status 0 (retryable)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = (await submitAttempt({ time_ms: 1, status: "valid" }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("GET /tournament/current/standings hits the proxied /api path with credentials", async () => {
    const STANDINGS = {
      iso_year: 2026,
      iso_week: 29,
      week_label: "2026-W29",
      event: "333",
      entries: [],
      your_entry: null,
      valid_count: 0,
      dnf_count: 0,
    };
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: STANDINGS }));
    const out = await getStandings();
    expect(out).toEqual(STANDINGS);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tournament/current/standings");
    expect(init.credentials).toBe("include");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("GET /tournament/current/standings forwards limit query param", async () => {
    const STANDINGS = {
      iso_year: 2026,
      iso_week: 29,
      week_label: "2026-W29",
      event: "333",
      entries: [],
      your_entry: null,
      valid_count: 0,
      dnf_count: 0,
    };
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: STANDINGS }));
    await getStandings(50);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tournament/current/standings?limit=50");
  });

  it("401 on GET /tournament/current/standings surfaces as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 401, json: { detail: "Unauthorized" } }));
    const err = (await getStandings().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });
});
