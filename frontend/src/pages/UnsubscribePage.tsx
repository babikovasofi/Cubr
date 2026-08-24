// /unsubscribe?token=… — reached from the "unsubscribe" link inside a chat
// notification letter (swarm-report/friend-chat-plan.md §7 "Этап B").
//
// Deliberately does NOT unsubscribe on load: mail clients prefetch links in a
// letter's body, and a silent GET-triggered unsubscribe would fire from the
// scanner, not the person (see the plan's §7 note on `List-Unsubscribe`). Only
// the button click POSTs. No auth — this page has no session to rely on; the
// token in the URL is the only credential.

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Button from "../components/Button";
import { unsubscribeChat } from "../api/email";
import { useT } from "../i18n/t";

type State = "idle" | "working" | "ok" | "bad";

export default function UnsubscribePage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "idle" : "bad");

  async function onClick() {
    if (!token) return;
    setState("working");
    try {
      await unsubscribeChat(token);
      setState("ok");
    } catch {
      // Generic "expired or bad" message regardless of cause (400 bad token,
      // network failure) — the plan doesn't ask for finer-grained copy here.
      setState("bad");
    }
  }

  return (
    <AuthShell
      title={t("Письма о новых сообщениях")}
      footer={
        <Link to="/" className="font-bold text-primary">
          {t("На главную")}
        </Link>
      }
    >
      {state === "idle" ? (
        <>
          <p className="font-sans text-body text-muted">
            {t(
              "Больше не получать письмо, когда друг пишет тебе, а ты давно не заходил на сайт. Сами сообщения в чате никуда не денутся.",
            )}
          </p>
          <Button onClick={() => void onClick()}>
            {t("Отписаться от писем о новых сообщениях")}
          </Button>
        </>
      ) : null}

      {state === "working" ? (
        <p className="font-sans text-body text-muted" role="status">
          {t("Отписываю…")}
        </p>
      ) : null}

      {state === "ok" ? (
        <p className="font-sans text-body text-success" role="status">
          {t(
            "Готово — письма о новых сообщениях больше не приходят. Включить их снова можно в профиле.",
          )}
        </p>
      ) : null}

      {state === "bad" ? (
        <p role="alert" className="font-sans text-body text-danger">
          {token
            ? t("Ссылка отписки недействительна или устарела. Отключить письма можно в профиле.")
            : t("В ссылке нет токена. Открой ссылку из письма целиком.")}
        </p>
      ) : null}
    </AuthShell>
  );
}
