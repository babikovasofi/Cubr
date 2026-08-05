// /auth/callback — where the backend redirects after Google OAuth. The cookie is
// already set (same-origin via the proxy); we read ?ok=1 / ?error=<code>, then on
// success re-probe /users/me and go home (or onboarding for first-timers).

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Spinner from "../components/Spinner";
import { useAuthStore } from "../store/authStore";
import { postLoginPath } from "../auth/onboarding";
import { useT } from "../i18n/t";

const ERROR_RU: Record<string, string> = {
  access_denied: "Доступ к Google-аккаунту не был предоставлен.",
  invalid_state: "Сессия входа устарела. Попробуй войти заново.",
};

export default function OAuthCallbackPage() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  const ok = params.get("ok");
  const errCode = params.get("error");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (ok !== "1") {
      setError(
        (errCode && ERROR_RU[errCode]) ?? "Не удалось войти через Google. Попробуй ещё раз.",
      );
      return;
    }
    refreshMe()
      .then(() => navigate(postLoginPath(null), { replace: true }))
      .catch(() => setError(t("Вход прошёл, но не удалось загрузить профиль. Попробуй обновить.")));
  }, [ok, errCode, refreshMe, navigate]);

  return (
    <AuthShell
      title={t("Вход через Google")}
      footer={
        error ? (
          <Link to="/login" className="font-bold text-primary">
            {t("Вернуться ко входу")}
          </Link>
        ) : undefined
      }
    >
      {error ? (
        <p role="alert" className="font-sans text-body text-danger">
          {error}
        </p>
      ) : (
        <Spinner label={t("Завершаю вход…")} />
      )}
    </AuthShell>
  );
}
