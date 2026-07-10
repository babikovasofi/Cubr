// /reset-password?token=… — two matching passwords → POST /api/auth/reset-password.
// Local mismatch check is client-side UX only; the token is validated server-side.

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Button from "../components/Button";
import Input from "../components/Input";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/client";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("В ссылке нет токена. Открой ссылку из письма целиком.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сбросить пароль.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Пароль обновлён"
        footer={
          <Link to="/login" className="font-bold text-primary">
            Войти с новым паролем
          </Link>
        }
      >
        <p className="font-sans text-body text-success">
          Готово. Теперь войди с новым паролем.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Новый пароль" subtitle="Придумай новый пароль для аккаунта.">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Новый пароль"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Повтори пароль"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить пароль"}
        </Button>
      </form>
    </AuthShell>
  );
}
