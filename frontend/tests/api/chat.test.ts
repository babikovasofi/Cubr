// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../../src/api/client";
import {
  blockFriend,
  deleteMessage,
  listConversations,
  listMessages,
  markRead,
  pollChat,
  sendMessage,
  unblockFriend,
  type ChatMessage,
  type ChatPollResult,
  type ConversationSummary,
} from "../../src/api/chat";

function res(opts: { status: number; json?: unknown; headers?: Record<string, string> }): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
    text: async () => (opts.json === undefined ? "" : JSON.stringify(opts.json)),
    headers: { get: (name: string) => opts.headers?.[name] ?? null },
  } as unknown as Response;
}

const MESSAGE: ChatMessage = {
  id: "msg-1",
  conversation_id: "conv-1",
  seq: 1,
  sender_id: "user-1",
  body: "hi",
  created_at: "2026-08-24T10:00:00Z",
  deleted_at: null,
};

const CONVERSATION: ConversationSummary = {
  id: "conv-1",
  friendship_id: "friendship-1",
  display_name: "SpeedCuber",
  last_message_body: "hi",
  last_message_at: "2026-08-24T10:00:00Z",
  unread_count: 2,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("chat api", () => {
  it("sendMessage POST /chat/conversations/{friendship_id}/messages with { body }", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 201, json: MESSAGE }));

    const out = await sendMessage("friendship-1", "hi");

    expect(out).toEqual(MESSAGE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/conversations/friendship-1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ body: "hi" });
  });

  it("listConversations GET /chat/conversations", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [CONVERSATION] }));

    const out = await listConversations();

    expect(out).toEqual([CONVERSATION]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/conversations");
  });

  it("listMessages GET .../messages with after_seq and limit query params", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [MESSAGE] }));

    const out = await listMessages("conv-1", { afterSeq: 5, limit: 20 });

    expect(out).toEqual([MESSAGE]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/chat/conversations/conv-1/messages?after_seq=5&limit=20",
    );
  });

  it("listMessages omits query string when no options given", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: [] }));

    await listMessages("conv-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/conversations/conv-1/messages");
  });

  it("markRead POST .../read with NO body", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await markRead("conv-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/conversations/conv-1/read");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("deleteMessage DELETE /chat/messages/{id}, id encoded", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await deleteMessage("id/with/slash");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/chat/messages/${encodeURIComponent("id/with/slash")}`);
    expect(init.method).toBe("DELETE");
  });

  it("pollChat GET /chat/poll?cursor=... and without cursor on first call", async () => {
    const POLL: ChatPollResult = { cursor: "next", messages: [] };
    fetchMock.mockResolvedValueOnce(res({ status: 200, json: POLL }));

    const out = await pollChat(null, new AbortController().signal);

    expect(out).toEqual(POLL);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/poll");

    fetchMock.mockResolvedValueOnce(res({ status: 200, json: POLL }));
    await pollChat("abc", new AbortController().signal);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chat/poll?cursor=abc");
  });

  it("blockFriend POST /chat/blocks/{friendship_id}", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await blockFriend("friendship-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/blocks/friendship-1");
    expect(init.method).toBe("POST");
  });

  it("unblockFriend DELETE /chat/blocks/{user_id} — takes the friend's USER id", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 204 }));

    await unblockFriend("user-42");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/blocks/user-42");
    expect(init.method).toBe("DELETE");
  });

  it("429 with Retry-After surfaces retryAfterSeconds on ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 429, json: { detail: "rate limited" }, headers: { "Retry-After": "12" } }),
    );

    try {
      await sendMessage("friendship-1", "hi");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(429);
      expect((e as ApiError).retryAfterSeconds).toBe(12);
    }
  });

  it("403 CHAT_NOT_FRIENDS carries the code (identical for blocked/pending/unknown)", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 403, json: { detail: { code: "CHAT_NOT_FRIENDS" } } }),
    );

    try {
      await sendMessage("friendship-1", "hi");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("CHAT_NOT_FRIENDS");
    }
  });

  it("422 MESSAGE_NOT_ALLOWED carries the code", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ status: 422, json: { detail: { code: "MESSAGE_NOT_ALLOWED" } } }),
    );

    try {
      await sendMessage("friendship-1", "bad word");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("MESSAGE_NOT_ALLOWED");
    }
  });
});
