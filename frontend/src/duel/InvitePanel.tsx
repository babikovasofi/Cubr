// Invite panel (plan: stage4-duel-by-link) — shown while a duel room is
// "waiting_opponent". Surfaces the join_url with a copy button; the copy
// affordance degrades to a plain selectable link if the Clipboard API is
// unavailable (insecure context / older browser) rather than silently
// failing.

import { useState } from "react";
import Button from "../components/Button";
import { useT } from "../i18n/t";

export interface InvitePanelProps {
  joinUrl: string;
}

export default function InvitePanel({ joinUrl }: InvitePanelProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-7">
      <span className="font-sans text-overline uppercase text-muted">{t("Дуэль по ссылке")}</span>
      <h3 className="font-sans text-h3 text-ink">{t("Жду соперника")}</h3>
      <p className="max-w-prose font-sans text-body text-muted">
        {t(
          "Отправь эту ссылку тому, с кем хочешь посоревноваться — дуэль начнётся, как только оба будут готовы.",
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-3">
        <a
          href={joinUrl}
          className="min-w-0 flex-1 truncate font-sans text-small font-bold text-ink no-underline"
        >
          {joinUrl}
        </a>
        {canCopy ? (
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? t("Скопировано") : t("Скопировать ссылку")}
          </Button>
        ) : null}
      </div>

      {copyError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {t("Не удалось скопировать — выдели и скопируй ссылку вручную.")}
        </p>
      ) : null}

      <p className="font-sans text-small text-muted" aria-live="polite">
        {t("Ожидаю подключения соперника…")}
      </p>

      {/* Honest about what this button does NOT do — plan: friends §14. */}
      <p className="font-sans text-small text-faint">
        {t("Уведомление не придёт — отправь ссылку сам.")}
      </p>
    </section>
  );
}
