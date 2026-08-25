import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import DecorBackdrop from "./components/DecorBackdrop";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import { ProtectedRoute, GuestOnlyRoute } from "./auth/ProtectedRoute";
import DesktopOnlyGate from "./components/DesktopOnlyGate";
import Spinner from "./components/Spinner";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import TrophyIcon from "./components/TrophyIcon";
import { ToastViewport } from "./components/Toast";
import { useAuthStore } from "./store/authStore";
import { useLangStore, type Lang } from "./store/langStore";
import { useUiStore, type Theme } from "./store/uiStore";
import SegmentedToggle from "./components/SegmentedToggle";
import { useT } from "./i18n/t";

// DEV-only Stage-0.3 accuracy gate. React.lazy + import.meta.env.DEV so the whole
// module (camera harness + accuracy panel) tree-shakes out of the prod bundle.
const AccuracyPage = import.meta.env.DEV ? lazy(() => import("./accuracy/AccuracyPage")) : null;
// DEV-only solo-timer start/stop tuning lab — same tree-shake pattern.
const TimingLabPage = import.meta.env.DEV ? lazy(() => import("./dev/TimingLabPage")) : null;

// Экраны с камерой тянут за собой MediaPipe (распознавание рук) и cubejs
// (солвер) — вместе это больше половины бандла, и до онбординга они не нужны
// ни разу. Человек с улицы читает лендинг, правила и форму регистрации; грузить
// ему заодно распознавание рук — это платить трафиком за экран, до которого он
// может и не дойти. Ленивыми сделаны ровно ритуальные роуты: лендинг, вход и
// текстовые страницы остаются в основном чанке, чтобы первый экран не мигал
// спиннером.
const SoloPage = lazy(() => import("./pages/SoloPage"));
const TournamentPage = lazy(() => import("./pages/TournamentPage"));
const DailyPage = lazy(() => import("./pages/DailyPage"));
const DuelPage = lazy(() => import("./pages/DuelPage"));
const DuelJoinPage = lazy(() => import("./pages/DuelJoinPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CupsPage = lazy(() => import("./pages/CupsPage"));

// Правила и приватность — длинная проза, и обе версии, русская и английская,
// лежат в бандле целиком (перевод здесь пофайловый, а не по словарю). Читают их
// один раз и по своей воле; в первый экран они попадать не обязаны.
const RulesPage = lazy(() => import("./pages/RulesPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));

// Reached from a chat-notification letter, never from in-app navigation — same
// tier as /verify and /reset-password: public, no ProtectedRoute.
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));

// PLL trainer (plan: ll-trainer): text + a diagram + a button, no camera, no
// timer, no socket — public like /rules and /privacy, no ProtectedRoute, no
// DesktopOnlyGate (it's more usable on a phone than most ritual modes).
const TrainerPage = lazy(() => import("./pages/TrainerPage"));

function AuthMenu() {
  const t = useT();
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
  const label = user.handle ?? user.email;
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
          `ink`, не эмодзи. Кликабелен — ведёт на отдельный экран дороги кубков.

          Показывается ТОЛЬКО когда кубки есть. Начислять их пока некому (рейтинг
          ждёт честностный кирпич), а «🏆 0» в шапке у каждого — обещание системы,
          которой нет. Появятся кубки — появится и бейдж, без правок здесь. */}
      {user.cups > 0 ? (
        <Link
          to="/cups"
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-surface-2 px-3.5 py-1 font-sans text-small font-black text-ink no-underline"
          aria-label={t("Кубки: {n}", { n: user.cups })}
        >
          <TrophyIcon size={16} />
          {user.cups}
        </Link>
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
              {t("Профиль")}
            </Link>
            <Link
              to="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="rounded px-3 py-2 font-sans text-small text-ink no-underline hover:bg-surface-2"
            >
              {t("Настройки")}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="rounded px-3 py-2 text-left font-sans text-small font-bold text-danger hover:bg-surface-2"
            >
              {t("Выйти")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Header() {
  const t = useT();
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
              {t("Войти")}
            </Link>
            <Link
              to="/register"
              className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-primary px-5 font-sans text-body font-extrabold text-white no-underline"
            >
              {t("Регистрация")}
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

// Этап 6: единственная сквозная точка входа в правила/приватность — под контентом,
// нейтральная (§1: цвет живёт в деталях, не в служебных блоках).
// Тема — рядом с языком, в футере: обе настройки служебные и сквозные, и обе
// не должны спорить с главным действием экрана. Раньше кнопка темы стояла
// посреди списка режимов на главной, где читалась как ещё один режим.
function ThemeSwitcher() {
  const t = useT();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  return (
    <div className="flex items-center gap-2 font-sans text-small text-muted">
      <span aria-hidden>{t("Тема")}</span>
      <SegmentedToggle<Theme>
        value={theme}
        onChange={setTheme}
        label={t("Тема")}
        options={[
          { value: "light", label: t("Светлая") },
          { value: "dark", label: t("Тёмная") },
        ]}
      />
    </div>
  );
}

function LanguageSwitcher() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  // Двухсегментная «таблетка» вместо системного <select>: тот рисует движок
  // браузера, и в макете он торчал чужим элементом. Подписи — «RU»/«EN», а не
  // названия языков: короткие, читаются на любом языке, не ломают строку футера.
  return (
    <div className="flex items-center gap-2 font-sans text-small text-muted">
      <span aria-hidden>{t("Язык интерфейса")}</span>
      <SegmentedToggle<Lang>
        value={lang}
        onChange={setLang}
        label={t("Язык интерфейса")}
        options={[
          { value: "ru", label: "RU" },
          { value: "en", label: "EN" },
        ]}
      />
    </div>
  );
}

function Footer() {
  const t = useT();
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6">
        <span className="font-sans text-small text-faint">Cubr</span>
        <Link to="/rules" className="font-sans text-small font-bold text-muted no-underline">
          {t("Правила")}
        </Link>
        <Link to="/privacy" className="font-sans text-small font-bold text-muted no-underline">
          {t("Данные и приватность")}
        </Link>
        {/* Переключатель языка — в футере, единственной сквозной служебной точке
            (там же, где правила и приватность). В шапке он отвлекал бы от CTA. */}
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </footer>
  );
}

export default function App() {
  const t = useT();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Probe the session once at boot (external sync: single network call at startup).
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="min-h-screen text-ink">
      <DecorBackdrop />
      <Header />
      <main className="mx-auto max-w-content px-4 py-7">
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
                <Spinner label={t("Загрузка…")} />
              </div>
            }
          >
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
              {/* Public, same tier as /rules and /privacy — see the comment
              above TrainerPage's lazy import. */}
              <Route path="/trainer" element={<TrainerPage />} />

              {AccuracyPage ? <Route path="/accuracy" element={<AccuracyPage />} /> : null}
              {/* DEV-only: онбординг без ProtectedRoute, чтобы смотреть туториал
                  локально без входа/бэкенда. В прод не попадает. */}
              {import.meta.env.DEV ? (
                <Route path="/onboarding-preview" element={<OnboardingPage />} />
              ) : null}
              {TimingLabPage ? <Route path="/lab" element={<TimingLabPage />} /> : null}

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
              <Route path="/unsubscribe" element={<UnsubscribePage />} />

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
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/cups"
                element={
                  <ProtectedRoute>
                    <CupsPage />
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
          </Suspense>
        </RouteErrorBoundary>
      </main>
      <Footer />
      <ToastViewport />
    </div>
  );
}
