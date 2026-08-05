// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getH2H, type DuelH2HRead } from "../../src/api/duel";

function res(opts: { status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json === undefined ? "" : JSON.stringify(opts.json)),
  } as unknown as Response;
}

const H2H_RECORD: DuelH2HRead = {
  played: 3,
  your_wins: 2,
  opponent_wins: 1,
  draws: 0,
  opponent_user_id: "opponent-uuid-1234",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("duel api", () => {
  it("getH2H GET /duel/rooms/{id}/h2h with typed return", async () => {
    const roomId = "room-uuid-1234";
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: H2H_RECORD }));

    const out = await getH2H(roomId);

    expect(out).toEqual(H2H_RECORD);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/duel/rooms/${encodeURIComponent(roomId)}/h2h`);
    expect(init.credentials).toBe("include");
  });

  it("getH2H includes AbortSignal when provided", async () => {
    const roomId = "room-uuid-5678";
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: H2H_RECORD }));

    const out = await getH2H(roomId, controller.signal);

    expect(out).toEqual(H2H_RECORD);
    const [_url, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });

  it("getH2H encodes room_id properly", async () => {
    const roomId = "room-with-special-chars/123";
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: H2H_RECORD }));

    await getH2H(roomId);

    const [url, _init] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent(roomId));
  });
});
