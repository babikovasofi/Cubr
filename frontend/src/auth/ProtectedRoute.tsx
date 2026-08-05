// Route guards (plan §B, skeptic MED). While the session is still probing
// (`loading`) we render a spinner — never the protected content and never a
// premature redirect, so there is no flash of the wrong screen. Anonymous users
// are sent to /login with a `next` param so we can return them afterwards.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import Spinner from "../components/Spinner";
import { useT } from "../i18n/t";

function FullBleedSpinner() {
  const t = useT();
  return (
    <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
      <Spinner label={t("Загрузка…")} />
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "loading") return <FullBleedSpinner />;
  if (status === "anon") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

export function GuestOnlyRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);

  if (status === "loading") return <FullBleedSpinner />;
  if (status === "authed") return <Navigate to="/" replace />;
  return <>{children}</>;
}
