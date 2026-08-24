// @vitest-environment jsdom
//
// useChatPoll owns the single per-tab long-poll loop (plan §7 Stage A, §2).
// Backend poll shape is {cursor, messages} only — no conversation summaries,
// no presence. Covers exactly the three behaviours the plan's Test plan
// calls out for the frontend: unread counting (via refetch after a poll),
// poll cursor advancing, and request cancellation on unmount.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useChatPoll } from "../../../src/friends/chat/useChatPoll";
import type { ChatMessage, ChatPollResult, ConversationSummary } from "../../../src/api/chat";

const { listConversationsMock, pollChatMock, listMessagesMock } = vi.hoisted(() => ({
  listConversationsMock: vi.fn(),
  pollChatMock: vi.fn(),
  listMessagesMock: vi.fn(),
}));

vi.mock("../../../src/api/chat", () => ({
  listConversations: listConversationsMock,
  listMessages: listMessagesMock,
  pollChat: pollChatMock,
}));

const CONVERSATION: ConversationSummary = {
  id: "conv-1",
  friendship_id: "friendship-1",
  display_name: "SpeedCuber",
  last_message_body: null,
  last_message_at: null,
  unread_count: 0,
};

const CONVERSATION_WITH_UNREAD: ConversationSummary = {
  ...CONVERSATION,
  unread_count: 3,
  last_message_body: "hi",
  last_message_at: "2026-08-24T10:00:00Z",
};

const MESSAGE: ChatMessage = {
  id: "msg-1",
  conversation_id: "conv-1",
  seq: 1,
  sender_id: "friend-1",
  body: "hi",
  created_at: "2026-08-24T10:00:00Z",
  deleted_at: null,
};

beforeEach(() => {
  listConversationsMock.mockReset();
  pollChatMock.mockReset();
  listMessagesMock.mockReset();
});

afterEach(cleanup);

describe("useChatPoll", () => {
  it("подсчёт непрочитанных: непустой poll триггерит рефетч /chat/conversations с новым unread_count", async () => {
    listConversationsMock.mockResolvedValueOnce([CONVERSATION]);
    let resolvePoll: ((r: ChatPollResult) => void) | null = null;
    pollChatMock.mockImplementation(
      () =>
        new Promise<ChatPollResult>((resolve) => {
          resolvePoll = resolve;
        }),
    );

    const { result } = renderHook(() => useChatPoll());

    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(result.current.conversations[0].unread_count).toBe(0);

    listConversationsMock.mockResolvedValueOnce([CONVERSATION_WITH_UNREAD]);
    await act(async () => {
      resolvePoll?.({ cursor: "c1", messages: [MESSAGE] });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.conversations[0].unread_count).toBe(3));
    expect(result.current.messagesByConversationId["conv-1"]).toEqual([MESSAGE]);
  });

  it("продвижение курсора опроса: следующий вызов pollChat получает cursor из предыдущего ответа", async () => {
    listConversationsMock.mockResolvedValue([CONVERSATION]);
    const calls: Array<string | null> = [];
    let call = 0;
    pollChatMock.mockImplementation((cursor: string | null) => {
      calls.push(cursor);
      call += 1;
      if (call === 1) {
        return Promise.resolve<ChatPollResult>({ cursor: "cursor-1", messages: [] });
      }
      return new Promise<ChatPollResult>(() => undefined); // hang on the second call
    });

    renderHook(() => useChatPoll());

    await waitFor(() => expect(calls).toEqual([null, "cursor-1"]));
  });

  it("отмена запроса при уходе со страницы: unmount абортит AbortSignal, переданный в pollChat", async () => {
    listConversationsMock.mockResolvedValue([CONVERSATION]);
    const captured: { signal: AbortSignal | null } = { signal: null };
    pollChatMock.mockImplementation(
      (_cursor: string | null, signal: AbortSignal) =>
        new Promise<ChatPollResult>((_resolve, reject) => {
          captured.signal = signal;
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const { unmount } = renderHook(() => useChatPoll());

    await waitFor(() => expect(captured.signal).not.toBeNull());
    expect(captured.signal?.aborted).toBe(false);

    unmount();

    expect(captured.signal?.aborted).toBe(true);
  });
});
