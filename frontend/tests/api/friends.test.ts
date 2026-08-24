// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acceptRequest,
  deleteRequest,
  listFriends,
  listIncoming,
  listOutgoing,
  removeFriend,
  sendRequest,
  type FriendRead,
  type FriendRequestRead,
} from "../../src/api/friends";

function res(opts: { status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json === undefined ? "" : JSON.stringify(opts.json)),
  } as unknown as Response;
}

const FRIEND: FriendRead = {
  friendship_id: "friendship-1",
  display_name: "SpeedCuber",
  since: "2026-08-01T00:00:00Z",
};

const REQUEST: FriendRequestRead = {
  friendship_id: "friendship-2",
  display_name: "Аноним",
  created_at: "2026-08-02T00:00:00Z",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("friends api", () => {
  it("listFriends GET /friends", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [FRIEND] }));

    const out = await listFriends();

    expect(out).toEqual([FRIEND]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/friends");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.credentials).toBe("include");
  });

  it("listIncoming GET /friends/requests/incoming", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [REQUEST] }));

    const out = await listIncoming();

    expect(out).toEqual([REQUEST]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/friends/requests/incoming");
  });

  it("listOutgoing GET /friends/requests/outgoing", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [REQUEST] }));

    const out = await listOutgoing();

    expect(out).toEqual([REQUEST]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/friends/requests/outgoing");
  });

  it("sendRequest POST /friends/requests with { handle }", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: REQUEST }));

    const out = await sendRequest("SpeedCuber");

    expect(out).toEqual(REQUEST);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/friends/requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ handle: "SpeedCuber" });
  });

  it("acceptRequest POST /friends/requests/{id}/accept, id encoded", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: FRIEND }));

    const out = await acceptRequest("id/with/slash");

    expect(out).toEqual(FRIEND);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/friends/requests/${encodeURIComponent("id/with/slash")}/accept`);
    expect(init.method).toBe("POST");
  });

  it("deleteRequest DELETE /friends/requests/{id}, id encoded", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await deleteRequest("id/with/slash");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/friends/requests/${encodeURIComponent("id/with/slash")}`);
    expect(init.method).toBe("DELETE");
  });

  it("removeFriend DELETE /friends/{id}, id encoded", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await removeFriend("id/with/slash");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/friends/${encodeURIComponent("id/with/slash")}`);
    expect(init.method).toBe("DELETE");
  });
});
