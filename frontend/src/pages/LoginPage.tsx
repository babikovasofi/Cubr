// Login (plan §B). Bad creds → RU error; unverified account → a resend branch;
// success → redirect to `next` (or onboarding for first-timers). Google + forgot
// links alongside.

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import GoogleButton from "../auth/GoogleButton";
import Button from "../components/Button";
import Input from "../components/Input";
import { useAuthStore } from "../store/authStore";
import { ApiError } from "../api/client";
import { requestVerify } from "../api/auth";
import { postLoginPath } from "../auth/onboarding";

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      await login(email, password);
      navigate(postLoginPath(params.get("next")), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.code === "LOGIN_USER_NOT_VERIFIED") setUnverified(true);
      } else {
        setError("Не удалось войти. Попробуй ещё раз.");
      }
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await requestVerify(email);
    } finally {
      setResent(true); // neutral regardless of outcome
    }
  }

  return (
    <AuthShell
      title="Вход"
      subtitle="Войди, чтобы сохранять сборки и рекорды."
      footer={
        <>
          Нет аккаунта?{" "}
          <Link to="/register" className="font-bold text-primary">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Почта"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Пароль"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />

        {unverified ? (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
            {resent ? (
              <p className="font-sans text-small text-muted">
                Если аккаунт существует и не подтверждён — новое письмо отправлено.
              </p>
            ) : (
              <button
                type="button"
                onClick={resend}
                className="self-start font-sans text-small font-bold text-primary"
              >
                Отправить письмо с подтверждением ещё раз
              </button>
            )}
          </div>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Вхожу…" : "Войти"}
        </Button>
      </form>

      <div className="flex items-center justify-between">
        <Link to="/forgot-password" className="font-sans text-small font-bold text-primary">
          Забыли пароль?
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-sans text-caption uppercase text-faint">или</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />
    </AuthShell>
  );
}
