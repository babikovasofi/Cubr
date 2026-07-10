import { useEffect, useRef, useState } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SoloPage from "./pages/SoloPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import OnboardingPage from "./pages/OnboardingPage";
import ProfilePage from "./pages/ProfilePage";
import { ProtectedRoute, GuestOnlyRoute } from "./auth/ProtectedRoute";
import { ToastViewport, toast } from "./components/Toast";
import { useAuthStore } from "./store/authStore";

function AuthMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user) return null;
  const label = user.nickname ?? user.email;
  const letter = label.trim().charAt(0).toUpperCase() || "?";

  async function onLogout() {
    setOpen(false);
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex items-center gap-3" ref={ref}>
      <span
        className="rounded-full border-2 border-ink bg-surface-2 px-2.5 py-0.5 font-sans text-caption uppercase text-ink"
        aria-label={`Кубки: ${user.cups}`}
      >
        {user.cups} кубк.
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-surface-2 font-sans text-small font-black text-ink"
        >
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            letter
          )}
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 flex w-44 flex-col rounded-md border-2 border-ink bg-surface p-1 shadow-sticker"
          >
            <Link
              to="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="rounded px-3 py-2 font-sans text-small text-ink no-underline hover:bg-surface-2"
            >
              Профиль
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                toast("Настройки появятся позже.", "info");
              }}
              className="rounded px-3 py-2 text-left font-sans text-small text-muted hover:bg-surface-2"
            >
              Настройки
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="rounded px-3 py-2 text-left font-sans text-small font-bold text-danger hover:bg-surface-2"
            >
              Выйти
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Header() {
  const status = useAuthStore((s) => s.status);

  return (
    <header className="h-12 border-b border-line bg-surface">
      <div className="mx-auto flex h-full max-w-content items-center justify-between px-4">
        <Link to="/" className="font-sans text-h3 font-black text-ink no-underline">
          Cubr
        </Link>
        {status === "authed" ? (
          <AuthMenu />
        ) : status === "anon" ? (
          <nav className="flex items-center gap-4">
            <Link to="/login" className="font-sans text-small font-bold text-primary no-underline">
              Войти
            </Link>
            <Link
              to="/register"
              className="inline-flex h-9 items-center rounded-full border-2 border-ink bg-primary px-4 font-sans text-small font-extrabold text-white no-underline"
            >
              Регистрация
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Probe the session once at boot (external sync: single network call at startup).
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <Header />
      <main className="mx-auto max-w-content px-4 py-7">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/solo" element={<SoloPage />} />

          <Route
            path="/login"
            element={
              <GuestOnlyRoute>
                <LoginPage />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestOnlyRoute>
                <RegisterPage />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <GuestOnlyRoute>
                <ForgotPasswordPage />
              </GuestOnlyRoute>
            }
          />
          <Route path="/verify" element={<VerifyEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<OAuthCallbackPage />} />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      <ToastViewport />
    </div>
  );
}
