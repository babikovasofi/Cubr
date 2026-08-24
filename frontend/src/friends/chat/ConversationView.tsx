// Message list + composer + block/unblock + delete-own-message for one
// conversation (plan §7 Stage A). Presentational + local send/delete/block
// wiring; the message cache and poll loop live in useChatPoll (ChatSection).
//
// `friendship_id: null` (backend contract) means the friendship behind this
// conversation is gone — unfriended, or removed by a block. Either way the
// conversation is read-only from here on: no composer, no (re)block. Unblock
// needs the friend's USER id, not a friendship id (there isn't one anymore);
// ChatSection derives it from any message in the conversation not sent by
// `meUserId` and passes it down — if the conversation has no messages yet,
// that id is unknown and unblock is unavailable until one arrives.

import { useState, type FormEvent } from "react";
import Button from "../../components/Button";
import { ApiError } from "../../api/client";
import {
  blockFriend,
  deleteMessage,
  sendMessage,
  unblockFriend,
  type ChatMessage,
  type ConversationSummary,
} from "../../api/chat";
import { useT } from "../../i18n/t";

const MESSAGE_MAX_LENGTH = 2000;

export default function ConversationView({
  conversation,
  friendshipId,
  friendUserId,
  meUserId,
  messages,
  blocked,
  onMessageSent,
  onMessageDeleted,
  onBlockedChange,
}: {
  conversation: ConversationSummary | null;
  /** Target for a brand-new conversation that has no summary yet. */
  friendshipId: string | null;
  friendUserId: string | null;
  meUserId: string | null;
  messages: ChatMessage[];
  blocked: boolean;
  onMessageSent: (friendshipId: string, message: ChatMessage) => void;
  onMessageDeleted: (messageId: string) => void;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);

  // A resolved conversation's own friendship_id is authoritative (it may
  // have gone null since the chat was opened); the `friendshipId` prop is
  // only a fallback for a conversation that doesn't exist server-side yet.
  const effectiveFriendshipId = conversation ? conversation.friendship_id : friendshipId;
  const readOnly = effectiveFriendshipId === null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy || !effectiveFriendshipId) return;
    setBusy(true);
    setError(null);
    try {
      const message = await sendMessage(effectiveFriendshipId, body);
      onMessageSent(effectiveFriendshipId, message);
      setDraft("");
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-sans text-small font-bold text-ink">
          {conversation?.display_name ?? t("Новая переписка")}
        </h3>
        {!readOnly || blocked ? (
          <Button
            variant="secondary"
            disabled={blockBusy || !canToggleBlock}
            onClick={() => void onToggleBlock()}
          >
            {blocked ? t("Разблокировать") : t("Заблокировать")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="font-sans text-small text-danger">
          {error}
        </p>
      ) : null}

      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto" aria-label={t("Сообщения")}>
        {messages.length === 0 ? (
          <li className="font-sans text-small text-muted">{t("Сообщений пока нет.")}</li>
        ) : null}
        {messages.map((m) => {
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
        <p className="font-sans text-small text-muted">
          {t("Переписка недоступна для новых сообщений: вы больше не друзья.")}
        </p>
      ) : (
        <form className="flex items-end gap-2" onSubmit={onSubmit} noValidate>
          <label className="flex-1">
            <span className="sr-only">{t("Сообщение")}</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={2}
              placeholder={t("Напиши сообщение…")}
              className="w-full resize-none rounded-md border-2 border-ink bg-surface px-3.5 py-2 font-sans text-body text-ink placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </label>
          <Button type="submit" disabled={busy || !draft.trim()}>
            {busy ? t("Отправляю…") : t("Отправить")}
          </Button>
        </form>
      )}
    </div>
  );
}
