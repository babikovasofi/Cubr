// Registration (plan §B): email + password + nickname → "подтвердите почту" screen
// with a resend action. Handles REGISTER_USER_ALREADY_EXISTS, invalid-password and
// rate-limit (429) via the client's RU mapping. Google alongside.

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import GoogleButton from "../auth/GoogleButton";
import Button from "../components/Button";
import Input from "../components/Input";
import { useAuthStore } from "../store/authStore";
import { ApiError } from "../api/client";
import { requestVerify } from "../api/auth";

export default function RegisterPage() {
  const register = useAuthStore((s) => s.register);

  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resent, setResent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, nickname.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось зарегистрироваться.");
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await requestVerify(email);
    } finally {
      setResent(true);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Подтвердите почту"
        subtitle="Мы отправили письмо со ссылкой подтверждения."
        footer={
          <Link to="/login" className="font-bold text-primary">
            Вернуться ко входу
          </Link>
        }
      >
        <p className="font-sans text-body text-muted">
          Открой письмо на адрес <span className="font-bold text-ink">{email}</span> и перейди по
          ссылке. После подтверждения сможешь войти.
        </p>
        {resent ? (
          <p className="font-sans text-small text-success">Письмо отправлено ещё раз.</p>
        ) : (
          <button
            type="button"
            onClick={resend}
            className="self-start font-sans text-small font-bold text-primary"
          >
            Отправить письмо ещё раз
          </button>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Регистрация"
      subtitle="Создай аккаунт, чтобы сохранять сборки."
      footer={
        <>
          Уже есть аккаунт?{" "}
          <Link to="/login" className="font-bold text-primary">
            Войти
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
          label="Никнейм"
          type="text"
          autoComplete="nickname"
          maxLength={64}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <Input
          label="Пароль"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        {/* Этап 6: согласие с правилами и политикой — текстом у кнопки, без
            отдельной галочки: одно действие «Зарегистрироваться», ссылки открыты
            анонимно. Тот же смысл распространяется и на вход через Google ниже. */}
        <p className="font-sans text-small text-muted">
          Регистрируясь, ты соглашаешься с{" "}
          <Link to="/rules" className="font-bold text-primary">
            правилами
          </Link>{" "}
          и{" "}
          <Link to="/privacy" className="font-bold text-primary">
            обработкой данных
          </Link>
          .
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Создаю…" : "Зарегистрироваться"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-sans text-caption uppercase text-faint">или</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />
    </AuthShell>
  );
}
