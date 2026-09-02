// @vitest-environment jsdom
//
// ChatSection — the /messages messenger (owner: "удобный чат... отдельным
// окном, друзей сбоку и сами чаты"). Mounts useChatPoll AND useChatFriends,
// so api/chat and api/friends are both mocked, no real network. Covers the
// sidebar toggle (Чаты/Друзья), opening a conversation from either tab, the
// active-row highlight, and the deep-link (`openFriendshipId`) prop.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import ChatSection from "../../../src/friends/chat/ChatSection";
import type { ChatMessage, ConversationSummary } from "../../../src/api/chat";
import type { FriendRead } from "../../../src/api/friends";

const {
  listConversationsMock,
  listMessagesMock,
  pollChatMock,
  markReadMock,
  listFriendsMock,
} = vi.hoisted(() => ({
  listConversationsMock: vi.fn(),
  listMessagesMock: vi.fn(),
  pollChatMock: vi.fn(),
  markReadMock: vi.fn(),
  listFriendsMock: vi.fn(),
}));

vi.mock("../../../src/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/chat")>();
  return {
    ...actual,
    listConversations: listConversationsMock,
    listMessages: listMessagesMock,
    pollChat: pollChatMock,
    markRead: markReadMock,
  };
});

vi.mock("../../../src/api/friends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/friends")>();
  return { ...actual, listFriends: listFriendsMock };
});

vi.mock("../../../src/store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "me" } }),
}));

const CONVERSATION: ConversationSummary = {
  id: "conv-1",
  friendship_id: "friendship-1",
  display_name: "SpeedCuber",
  last_message_body: "hi",
  last_message_at: "2026-08-24T10:00:00Z",
  unread_count: 0,
};

const MESSAGE: ChatMessage = {
  id: "msg-1",
  conversation_id: "conv-1",
  seq: 1,
  sender_id: "friend-1",
  body: "hi",
  kind: "text",
  invite: null,
  created_at: "2026-08-24T10:00:00Z",
  deleted_at: null,
};

const FRIEND_NO_CHAT: FriendRead = {
  friendship_id: "friendship-2",
  display_name: "NewPal",
  avatar_url: null,
  since: "2026-08-01T00:00:00Z",
  is_online: true,
};

beforeEach(() => {
  for (const m of [listConversationsMock, listMessagesMock, pollChatMock, markReadMock, listFriendsMock]) {
    m.mockReset();
  }
  listConversationsMock.mockResolvedValue([CONVERSATION]);
  listMessagesMock.mockResolvedValue([MESSAGE]);
  markReadMock.mockResolvedValue(undefined);
  listFriendsMock.mockResolvedValue([FRIEND_NO_CHAT]);
  // Never resolves: the poll loop just hangs, same as the real long-poll —
  // nothing here asserts on it (useChatPoll.test.tsx covers the loop itself).
  pollChatMock.mockReturnValue(new Promise(() => undefined));
});

afterEach(cleanup);

describe("ChatSection — сайдбар «Чаты»", () => {
  it("список переписок открывает переписку и подсвечивает активную", async () => {
    render(<ChatSection />);

    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());
    // Captured before the pane heading also reads "SpeedCuber" — this
    // reference stays the same DOM node across the re-render.
    const row = screen.getByText("SpeedCuber").closest("button") as HTMLElement;

    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-1", { limit: 50 }));
    // Conversation is now open — its name appears again as the pane heading.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "SpeedCuber" })).toBeTruthy(),
    );
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});

describe("ChatSection — сайдбар «Друзья»", () => {
  it("переключение на «Друзья» показывает друга и открывает с ним новую переписку", async () => {
    render(<ChatSection />);

    await waitFor(() => expect(listFriendsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("radio", { name: "Друзья" }));
    await waitFor(() => expect(screen.getByText("NewPal")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("NewPal"));
    });

    // No existing conversation for this friend — a fresh, unsaved chat opens.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Новая переписка" })).toBeTruthy(),
    );
  });
});

describe("ChatSection — deep link", () => {
  it("openFriendshipId сразу открывает существующую переписку", async () => {
    render(<ChatSection openFriendshipId="friendship-1" />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "SpeedCuber" })).toBeTruthy(),
    );
  });
});

describe("ChatSection — пустой выбор", () => {
  it("без выбора справа подсказка выбрать переписку", async () => {
    render(<ChatSection />);

    await waitFor(() =>
      expect(screen.getByText("Выбери переписку или друга слева, чтобы начать")).toBeTruthy(),
    );
  });
});

describe("ChatSection — deep link не переживает обновление списка переписок", () => {
  it("после «←» обновление /chat/conversations (poll wake) НЕ открывает диалог заново", async () => {
    let resolvePoll: ((r: { cursor: string; messages: ChatMessage[] }) => void) | null = null;
    pollChatMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );

    render(<ChatSection openFriendshipId="friendship-1" />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "SpeedCuber" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText("Назад к спискам"));
    await waitFor(() =>
      expect(screen.getByText("Выбери переписку или друга слева, чтобы начать")).toBeTruthy(),
    );

    // Poll wakes with a message — useChatPoll refetches /chat/conversations,
    // handing ChatSection a NEW array reference (same friendship-1 entry).
    // Before review finding #1's fix, the deep-link effect depended on that
    // array and reopened "SpeedCuber" right here.
    listConversationsMock.mockResolvedValueOnce([{ ...CONVERSATION, unread_count: 1 }]);
    await act(async () => {
      resolvePoll?.({ cursor: "c2", messages: [MESSAGE] });
      await Promise.resolve();
    });

    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "SpeedCuber" })).toBeNull();
    expect(screen.getByText("Выбери переписку или друга слева, чтобы начать")).toBeTruthy();
  });
});
