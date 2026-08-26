// Conversation list: unread badge + last message preview. Rendered inside
// ChatSection (plan §7 Stage A). No presence here — Stage A's poll exposes
// no "online now" signal (that's Stage C); selection is keyed by
// conversation id, not friendship id, since a read-only (unfriended/blocked)
// conversation has `friendship_id: null`.

import type { ConversationSummary } from "../../api/chat";
import { useT } from "../../i18n/t";

// Этап B: `body` is always null on an invite message (the invite itself
// carries the content) — without checking `last_message_kind` that null
// would render as "Сообщение удалено" for a brand-new duel invite, which is
// simply wrong.
function previewText(c: ConversationSummary, t: (key: string) => string): string {
  if (c.last_message_kind === "invite") return t("Приглашение на дуэль");
  return c.last_message_body ?? t("Сообщение удалено");
}

export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  onSelect: (conversation: ConversationSummary) => void;
}) {
  const t = useT();

  if (conversations.length === 0) {
    return (
      <p className="font-sans text-small text-muted">
        {t("Переписок пока нет — напиши другу из списка выше.")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c)}
            aria-current={c.id === selectedConversationId ? "true" : undefined}
            className={[
              "flex w-full items-center justify-between gap-3 rounded-md border-2 px-3.5 py-2.5 text-left",
              "transition-colors",
              c.id === selectedConversationId
                ? "border-ink bg-surface-2"
                : "border-line bg-surface hover:bg-surface-2",
            ].join(" ")}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-sans text-small font-bold text-ink">
                {c.display_name}
              </span>
              {c.last_message_body !== null || c.last_message_kind === "invite" || c.last_message_at ? (
                <span className="truncate font-sans text-small text-muted">
                  {previewText(c, t)}
                </span>
              ) : null}
            </span>
            {c.unread_count > 0 ? (
              <span
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-sans text-small font-extrabold text-white"
                aria-label={t("Непрочитанных: {n}", { n: c.unread_count })}
              >
                {c.unread_count}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
