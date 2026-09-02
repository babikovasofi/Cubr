// The /messages screen (owner: "удобный чат, чтобы пользоваться... можно
// сделать отдельным окном. в чате можно друзей сбоку и сами чаты"). A
// two-pane messenger: a sidebar (conversations / friends, toggled) on the
// left, the open conversation on the right. On narrow screens it collapses
// to one column — the sidebar OR the open conversation, never both, with a
// "←" back button to return. Owns the single per-tab poll loop via
// useChatPoll — mount this component exactly once (MessagesPage is the only
// caller).

import { useEffect, useRef, useState } from "react";
import Spinner from "../../components/Spinner";
import Button from "../../components/Button";
import SegmentedToggle from "../../components/SegmentedToggle";
import { useAuthStore } from "../../store/authStore";
import { useT } from "../../i18n/t";
import {
  markRead,
  type ChatMessage,
  type ConversationSummary,
  type DuelInviteRead,
} from "../../api/chat";
import { useChatPoll } from "./useChatPoll";
import { useChatFriends } from "./useChatFriends";
import ConversationList from "./ConversationList";
import ConversationView from "./ConversationView";
import ChatFriendsPanel from "./ChatFriendsPanel";

type SidebarTab = "chats" | "friends";

export default function ChatSection({
  /** Friend the caller wants to open a chat with right away (e.g. the
   * `?friendship=` deep link from the "Написать" button) — `null` leaves
   * nothing selected. */
  openFriendshipId,
  className = "",
}: {
  openFriendshipId?: string | null;
  className?: string;
}) {
  const t = useT();
  const meUserId = useAuthStore((s) => s.user?.id ?? null);
  const chat = useChatPoll();
  const chatFriends = useChatFriends();
  const [tab, setTab] = useState<SidebarTab>("chats");
  const [selection, setSelection] = useState<{
    conversationId: string | null;
    friendshipId: string | null;
  } | null>(null);
  // Session-local: the backend contract has no "am I the one who blocked
  // this" flag on a conversation (friendship_id just goes null either way),
  // so a block performed in this tab is remembered here for the Unblock
  // button. It does not survive a reload — acceptable for Stage A.
  const [blockedConversationIds, setBlockedConversationIds] = useState<Set<string>>(new Set());

  function openFriendship(friendshipId: string): void {
    const conv = chat.conversations.find((c) => c.friendship_id === friendshipId);
    setSelection({ conversationId: conv?.id ?? null, friendshipId });
  }

  // Applies `openFriendshipId` (the `?friendship=` deep link) exactly ONCE
  // per distinct value — a ref, not a dep-array trick, because `chat.conversations`
  // gets a new array identity on every poll wake / local patch (send, refresh
  // after a poll…). Depending on it here used to re-run this effect on every
  // such change and clobber `selection` back to `openFriendshipId`, silently
  // reopening the conversation after the reader had pressed "←" or switched
  // to someone else (review finding #1 — regression covered by
  // ChatSection.test.tsx "onBack переживает обновление списка переписок").
  const appliedOpenFriendshipIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openFriendshipId) return;
    if (appliedOpenFriendshipIdRef.current === openFriendshipId) return;
    appliedOpenFriendshipIdRef.current = openFriendshipId;
    openFriendship(openFriendshipId);
  }, [openFriendshipId]);

  // Backfills a pending selection's conversationId once the conversation
  // list has loaded (the deep link — or a friend picked from the "Друзья"
  // tab — may fire before `chat.conversations` has that friend's existing
  // history yet). Guarded on `prev.conversationId === null` so it only ever
  // touches a selection that is STILL unresolved; it never re-opens a
  // conversation the reader has since backed out of (`selection === null`)
  // or switched away from (a different, already-resolved selection).
  useEffect(() => {
    setSelection((prev) => {
      if (!prev || prev.conversationId !== null) return prev;
      const conv = chat.conversations.find((c) => c.friendship_id === prev.friendshipId);
      if (!conv) return prev;
      return { conversationId: conv.id, friendshipId: prev.friendshipId };
    });
  }, [chat.conversations]);

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
  const activeFriendshipIdForPresence = selectedConversation
    ? selectedConversation.friendship_id
    : (selection?.friendshipId ?? null);
  const friendOnline = activeFriendshipIdForPresence
    ? (chatFriends.friends.find((f) => f.friendship_id === activeFriendshipIdForPresence)
        ?.is_online ?? null)
    : null;

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

  const rootClassName = [
    "grid h-full min-h-0 overflow-hidden rounded-md border-2 border-ink bg-surface md:grid-cols-[minmax(16rem,20rem)_1fr]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (chat.loadState === "loading") {
    return (
      <div className={`${rootClassName} items-center justify-center`}>
        <Spinner label={t("Загружаю переписки…")} />
      </div>
    );
  }

  if (chat.loadState === "error") {
    return (
      <div className={`${rootClassName} items-center justify-center p-4`}>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">
            {chat.error ?? t("Не удалось загрузить переписки.")}
          </p>
          <Button onClick={() => void chat.refreshConversations()}>{t("Повторить")}</Button>
        </div>
      </div>
    );
  }

  // Master-detail on narrow screens: nothing selected shows the sidebar
  // (list of chats/friends) full width; a selection replaces it with the
  // open conversation full width. Both panes are always visible side by side
  // at md+ (grid-cols above), regardless of `showSidebarOnMobile`.
  const showSidebarOnMobile = selection === null;

  return (
    <div className={rootClassName}>
      <aside
        className={[
          showSidebarOnMobile ? "flex" : "hidden",
          "min-h-0 flex-col overflow-hidden md:flex md:border-r-2 md:border-ink",
        ].join(" ")}
      >
        <div className="shrink-0 border-b border-line p-3">
          <SegmentedToggle<SidebarTab>
            value={tab}
            onChange={setTab}
            label={t("Раздел")}
            options={[
              { value: "chats", label: t("Чаты") },
              { value: "friends", label: t("Друзья") },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "chats" ? (
            <ConversationList
              conversations={chat.conversations}
              activeConversationId={selectedConversation?.id ?? null}
              onSelect={handleSelectFromList}
            />
          ) : (
            <ChatFriendsPanel
              friends={chatFriends.friends}
              loadState={chatFriends.loadState}
              onSelect={openFriendship}
              onRetry={chatFriends.refresh}
            />
          )}
        </div>
      </aside>

      <section
        className={[
          showSidebarOnMobile ? "hidden" : "flex",
          "min-h-0 flex-col overflow-hidden md:flex",
        ].join(" ")}
      >
        {selection ? (
          <ConversationView
            conversation={selectedConversation}
            friendshipId={selection.friendshipId}
            friendUserId={friendUserId}
            meUserId={meUserId}
            online={friendOnline}
            messages={selectedMessages}
            blocked={blocked}
            onBack={() => setSelection(null)}
            onMessageSent={handleMessageSent}
            onMessageDeleted={handleMessageDeleted}
            onBlockedChange={handleBlockedChange}
            onInviteUpdated={handleInviteUpdated}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <p className="font-sans text-body font-bold text-ink">
              {t("Выбери переписку или друга слева, чтобы начать")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
