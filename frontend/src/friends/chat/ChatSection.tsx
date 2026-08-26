// Chat panel wired into FriendsSection (plan §7 Stage A): conversation list
// on the left, active conversation on the right. Owns the single per-tab
// poll loop via useChatPoll — mount this component exactly once.

import { useEffect, useState } from "react";
import Spinner from "../../components/Spinner";
import Button from "../../components/Button";
import { useAuthStore } from "../../store/authStore";
import { useT } from "../../i18n/t";
import {
  markRead,
  type ChatMessage,
  type ConversationSummary,
  type DuelInviteRead,
} from "../../api/chat";
import { useChatPoll } from "./useChatPoll";
import ConversationList from "./ConversationList";
import ConversationView from "./ConversationView";

export default function ChatSection({
  /** Friend the caller wants to open a chat with right away (e.g. from the
   * "Написать" button on a friend row) — `null` leaves nothing selected. */
  openFriendshipId,
}: {
  openFriendshipId?: string | null;
}) {
  const t = useT();
  const meUserId = useAuthStore((s) => s.user?.id ?? null);
  const chat = useChatPoll();
  const [selection, setSelection] = useState<{
    conversationId: string | null;
    friendshipId: string | null;
  } | null>(null);
  // Session-local: the backend contract has no "am I the one who blocked
  // this" flag on a conversation (friendship_id just goes null either way),
  // so a block performed in this tab is remembered here for the Unblock
  // button. It does not survive a reload — acceptable for Stage A.
  const [blockedConversationIds, setBlockedConversationIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!openFriendshipId) return;
    const conv = chat.conversations.find((c) => c.friendship_id === openFriendshipId);
    setSelection({ conversationId: conv?.id ?? null, friendshipId: openFriendshipId });
    // Re-run when the friend list changes (new "Написать" click) or once
    // conversations load so a brand-new-chat friendshipId resolves to its id.
  }, [openFriendshipId, chat.conversations]);

  const selectedConversation = selection?.conversationId
    ? (chat.conversations.find((c) => c.id === selection.conversationId) ?? null)
    : null;
  const selectedMessages = selectedConversation
    ? (chat.messagesByConversationId[selectedConversation.id] ?? [])
    : [];
  const friendUserId =
    selectedMessages.find((m) => meUserId !== null && m.sender_id !== meUserId)?.sender_id ?? null;
  const blocked = selectedConversation
    ? blockedConversationIds.has(selectedConversation.id)
    : false;

  // External sync: opening a conversation loads its history once — a plain
  // effect keyed on the resolved conversation id, not derivable during render.
  useEffect(() => {
    if (!selectedConversation) return;
    if (chat.messagesByConversationId[selectedConversation.id]) return;
    const conversationId = selectedConversation.id;
    void chat.loadHistory(conversationId).then((messages) => {
      if (messages.length === 0) return;
      chat.applyLocalConversationPatch(conversationId, { unread_count: 0 });
      void markRead(conversationId).catch(() => undefined);
    });
    // Deliberately keyed only on the resolved conversation id — `chat` is a
    // stable hook return (new object identity each render, same methods) and
    // re-running this on every chat state change would refetch history in a
    // loop.
  }, [selectedConversation?.id]);

  // External sync (Этап B): keeps useChatPoll's own ref of "which
  // conversation is open" current, so its poll loop knows which one to
  // re-pull on every wake for fresh invite state — see useChatPoll's
  // refetchOpenConversation. Same "keyed only on the id" reasoning as above.
  useEffect(() => {
    chat.setOpenConversationId(selectedConversation?.id ?? null);
    return () => chat.setOpenConversationId(null);
  }, [selectedConversation?.id]);

  function handleSelectFromList(conversation: ConversationSummary): void {
    setSelection({ conversationId: conversation.id, friendshipId: conversation.friendship_id });
  }

  function handleMessageSent(friendshipId: string, message: ChatMessage): void {
    const conv = chat.conversations.find((c) => c.friendship_id === friendshipId);
    if (conv) {
      chat.applyLocalMessage(conv.id, message);
      chat.applyLocalConversationPatch(conv.id, {
        last_message_body: message.body,
        last_message_at: message.created_at,
      });
    } else {
      // Brand-new conversation: the backend just created it — pull the fresh
      // list so it gets an id, then the effect above will resolve messages.
      void chat.refreshConversations();
    }
  }

  function handleMessageDeleted(messageId: string): void {
    if (!selectedConversation) return;
    chat.applyLocalDelete(selectedConversation.id, messageId);
  }

  function handleInviteUpdated(messageId: string, invite: DuelInviteRead): void {
    if (!selectedConversation) return;
    chat.applyLocalInvitePatch(selectedConversation.id, messageId, invite);
  }

  function handleBlockedChange(nextBlocked: boolean): void {
    if (!selectedConversation) return;
    setBlockedConversationIds((prev) => {
      const next = new Set(prev);
      if (nextBlocked) next.add(selectedConversation.id);
      else next.delete(selectedConversation.id);
      return next;
    });
    void chat.refreshConversations();
  }

  if (chat.loadState === "loading") {
    return <Spinner label={t("Загружаю переписки…")} />;
  }

  if (chat.loadState === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="font-sans text-small text-danger">
          {chat.error ?? t("Не удалось загрузить переписки.")}
        </p>
        <Button onClick={() => void chat.refreshConversations()}>{t("Повторить")}</Button>
      </div>
    );
  }

  // Master-detail (owner: "нажимаешь — отдельное окно"): the conversation list
  // spans the full width; picking one REPLACES the list with that conversation
  // (a back button returns), instead of a permanent side-by-side split with an
  // empty-state hint. `selection` with either a resolved conversation or a
  // pending friendshipId (brand-new chat from "Написать") counts as "open".
  const isOpen = selection !== null && (selectedConversation !== null || selection.friendshipId !== null);

  return (
    <div className="flex flex-col gap-4">
      {isOpen ? (
        <ConversationView
          conversation={selectedConversation}
          friendshipId={selection.friendshipId}
          friendUserId={friendUserId}
          meUserId={meUserId}
          messages={selectedMessages}
          blocked={blocked}
          onBack={() => setSelection(null)}
          onMessageSent={handleMessageSent}
          onMessageDeleted={handleMessageDeleted}
          onBlockedChange={handleBlockedChange}
          onInviteUpdated={handleInviteUpdated}
        />
      ) : (
        <ConversationList conversations={chat.conversations} onSelect={handleSelectFromList} />
      )}
    </div>
  );
}
