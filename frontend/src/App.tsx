import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SoloPage from "./pages/SoloPage";
import TournamentPage from "./pages/TournamentPage";
import DailyPage from "./pages/DailyPage";
import DuelPage from "./pages/DuelPage";
import DuelJoinPage from "./pages/DuelJoinPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import OnboardingPage from "./pages/OnboardingPage";
import ProfilePage from "./pages/ProfilePage";
import RulesPage from "./pages/RulesPage";
import PrivacyPage from "./pages/PrivacyPage";
import { ProtectedRoute, GuestOnlyRoute } from "./auth/ProtectedRoute";
import DesktopOnlyGate from "./components/DesktopOnlyGate";
import TrophyIcon from "./components/TrophyIcon";
import { ToastViewport, toast } from "./components/Toast";
import { useAuthStore } from "./store/authStore";

// DEV-only Stage-0.3 accuracy gate. React.lazy + import.meta.env.DEV so the whole
// module (camera harness + accuracy panel) tree-shakes out of the prod bundle.
const AccuracyPage = import.meta.env.DEV ? lazy(() => import("./accuracy/AccuracyPage")) : null;

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
      {/* Бейдж кубков. Отступление от §5.6: заливка нейтральная, а не `warning` —
          жёлтая пилюля в шапке перетягивала на себя весь экран. Кубок — контуром
          `ink`, не эмодзи.

          Показывается ТОЛЬКО когда кубки есть. Начислять их пока некому (рейтинг
          ждёт честностный кирпич), а «🏆 0» в шапке у каждого — обещание системы,
          которой нет. Появятся кубки — появится и бейдж, без правок здесь. */}
      {user.cups > 0 ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-surface-2 px-3.5 py-1 font-sans text-small font-black text-ink"
          aria-label={`Кубки: ${user.cups}`}
        >
          <TrophyIcon className="h-4 w-4" />
          {user.cups}
        </span>
      ) : null}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-surface-2 font-sans text-body font-black text-ink"
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
    // Шапка 64px вместо 48px из §6: со знаком Л1 и словомарком 24px прежняя
    // высота душила логотип. Граница снизу `1px line` — как в спеке.
    <header className="h-16 border-b border-line bg-surface">
      <div className="mx-auto flex h-full max-w-content items-center justify-between px-4">
        {/* Словомарк без знака 2×2: знак из §6 пробовали в шапке — визуально
            перегружал, оставлен только словомарк. */}
        <Link to="/" className="font-sans text-h2 font-black text-ink no-underline">
          Cubr
        </Link>
        {status === "authed" ? (
          <AuthMenu />
        ) : status === "anon" ? (
          <nav className="flex items-center gap-5">
            <Link to="/login" className="font-sans text-body font-bold text-primary no-underline">
              Войти
            </Link>
            <Link
              to="/register"
              className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-primary px-5 font-sans text-body font-extrabold text-white no-underline"
            >
              Регистрация
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

// Этап 6: единственная сквозная точка входа в правила/приватность — под контентом,
// нейтральная (§1: цвет живёт в деталях, не в служебных блоках).
function Footer() {
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6">
        <span className="font-sans text-small text-faint">Cubr</span>
        <Link to="/rules" className="font-sans text-small font-bold text-muted no-underline">
          Правила
        </Link>
        <Link to="/privacy" className="font-sans text-small font-bold text-muted no-underline">
          Данные и приватность
        </Link>
      </div>
    </footer>
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
          {/* Этап 6 (R8): ритуальные роуты под десктопным гейтом — с телефона
              вместо сломанной камеры показывается честная заглушка. */}
          <Route
            path="/solo"
            element={
              <DesktopOnlyGate>
                <SoloPage />
              </DesktopOnlyGate>
            }
          />
          {/* Этап 6: публичные текстовые страницы — читаются ДО регистрации. */}
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          {AccuracyPage ? (
            <Route
              path="/accuracy"
              element={
                <Suspense fallback={<p className="font-sans text-body text-muted">Загрузка…</p>}>
                  <AccuracyPage />
                </Suspense>
              }
            />
          ) : null}

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
          <Route
            path="/tournament"
            element={
              <ProtectedRoute>
                <DesktopOnlyGate>
                  <TournamentPage />
                </DesktopOnlyGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily"
            element={
              <ProtectedRoute>
                <DesktopOnlyGate>
                  <DailyPage />
                </DesktopOnlyGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duel/join/:token"
            element={
              <ProtectedRoute>
                <DesktopOnlyGate>
                  <DuelJoinPage />
                </DesktopOnlyGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duel/:roomId"
            element={
              <ProtectedRoute>
                <DesktopOnlyGate>
                  <DuelPage />
                </DesktopOnlyGate>
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      <Footer />
      <ToastViewport />
    </div>
  );
}
