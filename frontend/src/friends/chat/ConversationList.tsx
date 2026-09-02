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
  activeConversationId = null,
  onSelect,
}: {
  conversations: ConversationSummary[];
  /** Highlights the currently open conversation (messenger sidebar). */
  activeConversationId?: string | null;
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
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
      {conversations.map((c) => {
        const hasPreview =
          c.last_message_body !== null || c.last_message_kind === "invite" || !!c.last_message_at;
        const active = c.id === activeConversationId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              aria-current={active ? "true" : undefined}
              className={[
                "flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left transition-colors",
                active ? "bg-surface-2" : "bg-surface hover:bg-surface-2",
              ].join(" ")}
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface-2 font-sans text-body font-black text-ink"
              >
                {c.display_name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-sans text-small font-bold text-ink">
                  {c.display_name}
                </span>
                {hasPreview ? (
                  <span className="truncate font-sans text-small text-muted">{previewText(c, t)}</span>
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
              <span aria-hidden className="shrink-0 font-sans text-body text-muted">
                ›
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
