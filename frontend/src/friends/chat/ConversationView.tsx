// Message list + composer + block/unblock + delete-own-message for one
// conversation — the right-hand pane of the /messages messenger (owner:
// "удобный чат, чтобы пользоваться... можно сделать отдельным окном").
// Presentational + local send/delete/block wiring; the message cache and
// poll loop live in useChatPoll (ChatSection).
//
// `friendship_id: null` (backend contract) means the friendship behind this
// conversation is gone — unfriended, or removed by a block. Either way the
// conversation is read-only from here on: no composer, no (re)block. Unblock
// needs the friend's USER id, not a friendship id (there isn't one anymore);
// ChatSection derives it from any message in the conversation not sent by
// `meUserId` and passes it down — if the conversation has no messages yet,
// that id is unknown and unblock is unavailable until one arrives.
//
// Layout: fills its flex parent (`h-full min-h-0 flex flex-col`) — header
// and composer are fixed-size flex children, the message list is the ONLY
// scrolling region (`flex-1 min-h-0 overflow-y-auto`), matching the plan's
// "only the message feed and the left list scroll, the page itself doesn't
// jump". Autoscroll: opening a conversation (or switching to a different
// one) always jumps to the bottom; a new message only autoscrolls if the
// reader was already at the bottom — scrolled-up history reading is never
// yanked out from under them.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import Button from "../../components/Button";
import { ApiError } from "../../api/client";
import {
  blockFriend,
  deleteMessage,
  sendInvite,
  sendMessage,
  unblockFriend,
  type ChatMessage,
  type ConversationSummary,
  type DuelInviteRead,
} from "../../api/chat";
import { useT } from "../../i18n/t";
import InviteMessage from "./InviteMessage";

const MESSAGE_MAX_LENGTH = 2000;
// ~5 lines of the composer's 16px/1.4 text plus its own padding, before the
// textarea stops growing and starts scrolling internally instead.
const TEXTAREA_MAX_HEIGHT_PX = 132;
// Треш-холд «читатель у низа ленты» — сколько px нехватки скролла ещё
// считается «внизу», чтобы не требовать пиксель-в-пиксель точности.
const AT_BOTTOM_THRESHOLD_PX = 80;

export default function ConversationView({
  conversation,
  friendshipId,
  friendUserId,
  meUserId,
  online = null,
  messages,
  blocked,
  onBack,
  onMessageSent,
  onMessageDeleted,
  onBlockedChange,
  onInviteUpdated,
}: {
  conversation: ConversationSummary | null;
  /** Target for a brand-new conversation that has no summary yet. */
  friendshipId: string | null;
  friendUserId: string | null;
  meUserId: string | null;
  /** Friend's presence, when known (looked up by friendship_id in the
   * sidebar's friend list) — `null` renders no dot. */
  online?: boolean | null;
  messages: ChatMessage[];
  blocked: boolean;
  /** Return to the conversation list — shown as a "←" button, mobile only
   * (the sidebar stays visible on wider screens). Absent = no back affordance. */
  onBack?: () => void;
  onMessageSent: (friendshipId: string, message: ChatMessage) => void;
  onMessageDeleted: (messageId: string) => void;
  onBlockedChange: (blocked: boolean) => void;
  onInviteUpdated: (messageId: string, invite: DuelInviteRead) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const menuRef = useRef<HTMLDivElement>(null);

  // A resolved conversation's own friendship_id is authoritative (it may
  // have gone null since the chat was opened); the `friendshipId` prop is
  // only a fallback for a conversation that doesn't exist server-side yet.
  const effectiveFriendshipId = conversation ? conversation.friendship_id : friendshipId;
  const readOnly = effectiveFriendshipId === null;
  const conversationKey = conversation?.id ?? friendshipId ?? null;

  // External sync: opening a conversation (or switching to a different one)
  // always snaps to its newest message — a real DOM scroll position, not
  // something render can express.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [conversationKey]);

  // External sync: a new message arrives — follow it ONLY if the reader was
  // already at the bottom (see atBottomRef, updated by handleScroll).
  useEffect(() => {
    const el = listRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // External sync: close the compact actions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function handleScroll(e: UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD_PX;
  }

  function autoGrowTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }

  function onDraftChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    autoGrowTextarea(e.target);
  }

  async function submitDraft() {
    const body = draft.trim();
    if (!body || busy || !effectiveFriendshipId) return;
    setBusy(true);
    setError(null);
    try {
      const message = await sendMessage(effectiveFriendshipId, body);
      onMessageSent(effectiveFriendshipId, message);
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (e) {
      if (e instanceof ApiError && e.code === "MESSAGE_NOT_ALLOWED") {
        setError(t("Сообщение не разрешено."));
      } else if (e instanceof ApiError && e.status === 429) {
        setError(
          e.retryAfterSeconds
            ? t("Слишком часто. Подожди {n} с.", { n: e.retryAfterSeconds })
            : t("Слишком много сообщений. Подожди немного."),
        );
      } else if (e instanceof ApiError && e.code === "CHAT_NOT_FRIENDS") {
        setError(t("Нельзя написать: вы не друзья или переписка заблокирована."));
      } else {
        setError(t("Не удалось отправить сообщение."));
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submitDraft();
  }

  // Enter sends, Shift+Enter inserts a newline — standard messenger keymap.
  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME composing a CJK/etc. character also fires "Enter" to confirm
    // the candidate — that Enter must land in the textarea, not send the
    // (still-being-typed) draft (review finding #2).
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitDraft();
    }
  }

  async function onDelete(messageId: string) {
    try {
      await deleteMessage(messageId);
      onMessageDeleted(messageId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Не удалось удалить сообщение."));
    }
  }

  async function onToggleBlock() {
    setBlockBusy(true);
    setError(null);
    try {
      if (blocked) {
        if (!friendUserId) return;
        await unblockFriend(friendUserId);
        onBlockedChange(false);
      } else {
        if (!effectiveFriendshipId) return;
        await blockFriend(effectiveFriendshipId);
        onBlockedChange(true);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Не удалось изменить блокировку."));
    } finally {
      setBlockBusy(false);
    }
  }

  const canToggleBlock = blocked ? friendUserId !== null : effectiveFriendshipId !== null;

  // friends-hub plan, Этап B: creates an invite-СООБЩЕНИЕ (no duel room yet
  // — see api/chat.ts's sendInvite docstring). Reuses the same
  // onMessageSent wiring a text send already uses to land it in the cache.
  async function onSendInvite() {
    if (!effectiveFriendshipId || inviteBusy) return;
    setInviteBusy(true);
    setError(null);
    try {
      const message = await sendInvite(effectiveFriendshipId);
      onMessageSent(effectiveFriendshipId, message);
    } catch (e) {
      setError(
        e instanceof ApiError ? t(e.message) : t("Не удалось отправить приглашение на дуэль."),
      );
    } finally {
      setInviteBusy(false);
    }
  }

  const showInviteAction = !readOnly;
  const showBlockAction = !readOnly || blocked;
  const hasActions = showInviteAction || showBlockAction;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("Назад к спискам")}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface font-sans text-body font-black text-ink hover:bg-surface-2 md:hidden"
            >
              <span aria-hidden>←</span>
            </button>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate font-sans text-body font-bold text-ink">
              {conversation?.display_name ?? t("Новая переписка")}
            </h2>
            {online === true ? (
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-success" />
            ) : null}
            {online !== null ? (
              <span className="sr-only">{online ? t("в сети") : t("не в сети")}</span>
            ) : null}
          </div>
        </div>

        {hasActions ? (
          <>
            {/* Desktop/wide: actions inline. */}
            <div className="hidden items-center gap-2 md:flex">
              {showInviteAction ? (
                <Button variant="secondary" disabled={inviteBusy} onClick={() => void onSendInvite()}>
                  {inviteBusy ? t("Отправляю приглашение…") : t("Позвать на дуэль")}
                </Button>
              ) : null}
              {showBlockAction ? (
                <Button
                  variant="secondary"
                  disabled={blockBusy || !canToggleBlock}
                  onClick={() => void onToggleBlock()}
                >
                  {blocked ? t("Разблокировать") : t("Заблокировать")}
                </Button>
              ) : null}
            </div>

            {/* Narrow screens: same actions collapsed into a "⋯" menu so the
                header never wraps/breaks the layout. */}
            <div className="relative md:hidden" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t("Действия")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-surface font-sans text-h3 font-black text-ink hover:bg-surface-2"
              >
                <span aria-hidden>⋯</span>
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 flex w-52 flex-col gap-1 rounded-md border-2 border-ink bg-surface p-1.5 shadow-sticker"
                >
                  {showInviteAction ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={inviteBusy}
                      onClick={() => {
                        setMenuOpen(false);
                        void onSendInvite();
                      }}
                      className="rounded px-3 py-2 text-left font-sans text-small font-bold text-ink hover:bg-surface-2 disabled:text-faint"
                    >
                      {inviteBusy ? t("Отправляю приглашение…") : t("Позвать на дуэль")}
                    </button>
                  ) : null}
                  {showBlockAction ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={blockBusy || !canToggleBlock}
                      onClick={() => {
                        setMenuOpen(false);
                        void onToggleBlock();
                      }}
                      className="rounded px-3 py-2 text-left font-sans text-small font-bold text-ink hover:bg-surface-2 disabled:text-faint"
                    >
                      {blocked ? t("Разблокировать") : t("Заблокировать")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="shrink-0 px-3 pt-2 font-sans text-small text-danger">
          {error}
        </p>
      ) : null}

      <ul
        ref={listRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
        aria-label={t("Сообщения")}
      >
        {messages.length === 0 ? (
          <li className="font-sans text-small text-muted">{t("Сообщений пока нет.")}</li>
        ) : null}
        {messages.map((m) => {
          if (m.kind === "invite") {
            return (
              <li key={m.id} className="flex justify-center">
                <InviteMessage
                  message={m}
                  meUserId={meUserId}
                  friendDisplayName={conversation?.display_name ?? t("Собеседник")}
                  onInviteUpdated={onInviteUpdated}
                />
              </li>
            );
          }
          const mine = meUserId !== null && m.sender_id === meUserId;
          const deleted = m.body === null;
          return (
            <li
              key={m.id}
              className={["flex flex-col gap-0.5", mine ? "items-end" : "items-start"].join(" ")}
            >
              <div
                className={[
                  "max-w-[80%] rounded-md border-2 border-ink px-3 py-2 font-sans text-small",
                  deleted
                    ? "bg-surface text-faint"
                    : mine
                      ? "bg-primary text-white"
                      : "bg-surface text-ink",
                ].join(" ")}
              >
                {deleted ? <em>{t("Сообщение удалено")}</em> : m.body}
              </div>
              <span className="flex items-center gap-2 font-sans text-small text-faint">
                {new Date(m.created_at).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {mine && !deleted ? (
                  <button
                    type="button"
                    onClick={() => void onDelete(m.id)}
                    className="font-sans text-small text-muted underline hover:text-ink"
                  >
                    {t("Удалить")}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {readOnly ? (
        <p className="shrink-0 border-t border-line p-3 font-sans text-small text-muted">
          {t("Переписка недоступна для новых сообщений: вы больше не друзья.")}
        </p>
      ) : (
        <form className="flex shrink-0 items-end gap-2 border-t border-line p-3" onSubmit={onSubmit} noValidate>
          <label className="flex-1">
            <span className="sr-only">{t("Сообщение")}</span>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={onDraftChange}
              onKeyDown={onTextareaKeyDown}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={1}
              placeholder={t("Напиши сообщение…")}
              // text-[16px]: below 16px iOS Safari zooms the page on focus.
              className="max-h-[132px] min-h-11 w-full resize-none overflow-y-auto rounded-md border-2 border-ink bg-surface px-3.5 py-2.5 font-sans text-[16px] leading-snug text-ink placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </label>
          <Button type="submit" disabled={busy || !draft.trim()} aria-label={busy ? t("Отправляю…") : t("Отправить")}>
            <span className="hidden sm:inline">{busy ? t("Отправляю…") : t("Отправить")}</span>
            <span className="sm:hidden" aria-hidden>
              →
            </span>
          </Button>
        </form>
      )}
    </div>
  );
}
