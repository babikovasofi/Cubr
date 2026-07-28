// /verify?token=… — auto-POSTs the token to /api/auth/verify on mount and shows
// success / expired / failure. Uses an effect (external sync: fires a network call
// exactly once from a URL param) with a ref guard against StrictMode double-run.

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Spinner from "../components/Spinner";
import { verify } from "../api/auth";
import { useT } from "../i18n/t";

type State = "working" | "ok" | "bad" | "notoken";

export default function VerifyEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "working" : "notoken");
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verify(token)
      .then(() => setState("ok"))
      .catch(() => setState("bad"));
  }, [token]);

  return (
    <AuthShell
      title={t("Подтверждение почты")}
      footer={
        <Link to="/login" className="font-bold text-primary">
          {t("Перейти ко входу")}
        </Link>
      }
    >
      {state === "working" ? <Spinner label={t("Подтверждаю…")} /> : null}
      {state === "ok" ? (
        <p className="font-sans text-body text-success">
          {t("Почта подтверждена. Теперь можно войти.")}
        </p>
      ) : null}
      {state === "bad" ? (
        <p role="alert" className="font-sans text-body text-danger">
          {t("Ссылка подтверждения недействительна или устарела. Войди и запроси новое письмо.")}
        </p>
      ) : null}
      {state === "notoken" ? (
        <p role="alert" className="font-sans text-body text-danger">
          {t("В ссылке нет токена. Открой ссылку из письма целиком.")}
        </p>
      ) : null}
    </AuthShell>
  );
}
