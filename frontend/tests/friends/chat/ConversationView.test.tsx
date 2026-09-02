// @vitest-environment jsdom
//
// ConversationView — the open-conversation pane of the /messages messenger.
// Covers the messenger-specific behaviour added for the redesign: Enter
// sends / Shift+Enter doesn't, the read-only (unfriended) state hides the
// composer, the online dot, and the header actions collapsing into a "⋯"
// menu (both the inline and the menu copy of each action render in jsdom —
// CSS media queries don't apply — so assertions scope into the menu with
// `within` rather than relying on only one match existing).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ConversationView from "../../../src/friends/chat/ConversationView";
import { ApiError } from "../../../src/api/client";
import type { ChatMessage, ConversationSummary } from "../../../src/api/chat";

const { sendMessageMock, sendInviteMock, blockFriendMock, unblockFriendMock, deleteMessageMock } =
  vi.hoisted(() => ({
    sendMessageMock: vi.fn(),
    sendInviteMock: vi.fn(),
    blockFriendMock: vi.fn(),
    unblockFriendMock: vi.fn(),
    deleteMessageMock: vi.fn(),
  }));

vi.mock("../../../src/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/chat")>();
  return {
    ...actual,
    sendMessage: sendMessageMock,
    sendInvite: sendInviteMock,
    blockFriend: blockFriendMock,
    unblockFriend: unblockFriendMock,
    deleteMessage: deleteMessageMock,
  };
});

const CONVERSATION: ConversationSummary = {
  id: "conv-1",
  friendship_id: "friendship-1",
  display_name: "SpeedCuber",
  last_message_body: "hi",
  last_message_at: "2026-08-24T10:00:00Z",
  unread_count: 0,
};

const READ_ONLY_CONVERSATION: ConversationSummary = { ...CONVERSATION, friendship_id: null };

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

function baseProps() {
  return {
    conversation: CONVERSATION,
    friendshipId: CONVERSATION.friendship_id,
    friendUserId: "friend-1",
    meUserId: "me",
    online: null as boolean | null,
    messages: [MESSAGE],
    blocked: false,
    onBack: vi.fn(),
    onMessageSent: vi.fn(),
    onMessageDeleted: vi.fn(),
    onBlockedChange: vi.fn(),
    onInviteUpdated: vi.fn(),
  };
}

function renderView(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  return render(
    <BrowserRouter>
      <ConversationView {...baseProps()} {...overrides} />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  for (const m of [sendMessageMock, sendInviteMock, blockFriendMock, unblockFriendMock, deleteMessageMock]) {
    m.mockReset();
  }
});

afterEach(cleanup);

describe("ConversationView — композер", () => {
  it("Enter отправляет сообщение", async () => {
    sendMessageMock.mockResolvedValue({ ...MESSAGE, id: "msg-2", body: "привет", sender_id: "me" });
    const onMessageSent = vi.fn();
    renderView({ onMessageSent });

    const textarea = screen.getByLabelText("Сообщение");
    fireEvent.change(textarea, { target: { value: "привет" } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("friendship-1", "привет"));
    await waitFor(() => expect(onMessageSent).toHaveBeenCalled());
  });

  it("Shift+Enter не отправляет — переносит строку", () => {
    renderView();

    const field = screen.getByLabelText("Сообщение");
    fireEvent.change(field, { target: { value: "первая строка" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("Enter во время IME-композиции (напр. японской раскладки) не отправляет", () => {
    renderView();

    const field = screen.getByLabelText("Сообщение");
    fireEvent.change(field, { target: { value: "こんにちは" } });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("readOnly-переписка (нет friendship_id) не показывает композер", () => {
    renderView({ conversation: READ_ONLY_CONVERSATION, friendshipId: null });

    expect(screen.queryByLabelText("Сообщение")).toBeNull();
    expect(
      screen.getByText("Переписка недоступна для новых сообщений: вы больше не друзья."),
    ).toBeTruthy();
  });

  it("429 с retry-after показывает секунды ожидания", async () => {
    sendMessageMock.mockRejectedValue(new ApiError(429, null, "rate limited", null, 12));
    renderView();

    const textarea = screen.getByLabelText("Сообщение");
    fireEvent.change(textarea, { target: { value: "спам" } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    await waitFor(() => expect(screen.getByText("Слишком часто. Подожди 12 с.")).toBeTruthy());
  });
});

describe("ConversationView — шапка", () => {
  it("онлайн-точка помечает собеседника «в сети»", () => {
    renderView({ online: true });
    expect(screen.getByText("в сети")).toBeTruthy();
  });

  it("без известного статуса точка не рендерится", () => {
    renderView({ online: null });
    expect(screen.queryByText("в сети")).toBeNull();
    expect(screen.queryByText("не в сети")).toBeNull();
  });

  it("кнопка «←» вызывает onBack", () => {
    const onBack = vi.fn();
    renderView({ onBack });

    fireEvent.click(screen.getByLabelText("Назад к спискам"));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ConversationView — действия в компактном меню", () => {
  it("«⋯» открывает меню с «Позвать на дуэль» и «Заблокировать»", async () => {
    sendInviteMock.mockResolvedValue({ ...MESSAGE, id: "msg-invite", kind: "invite" });
    const onMessageSent = vi.fn();
    renderView({ onMessageSent });

    fireEvent.click(screen.getByLabelText("Действия"));
    const menu = screen.getByRole("menu");

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Позвать на дуэль" }));
    });

    await waitFor(() => expect(sendInviteMock).toHaveBeenCalledWith("friendship-1"));
    await waitFor(() => expect(onMessageSent).toHaveBeenCalled());
  });

  it("заблокированная (но ещё видимая) переписка предлагает «Разблокировать»", () => {
    renderView({ conversation: READ_ONLY_CONVERSATION, friendshipId: null, blocked: true });

    fireEvent.click(screen.getByLabelText("Действия"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Разблокировать" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Позвать на дуэль" })).toBeNull();
  });
});
