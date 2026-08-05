// /reset-password?token=… — two matching passwords → POST /api/auth/reset-password.
// Local mismatch check is client-side UX only; the token is validated server-side.

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Button from "../components/Button";
import Input from "../components/Input";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

export default function ResetPasswordPage() {
  const t = useT();
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
      setError(t("В ссылке нет токена. Открой ссылку из письма целиком."));
      return;
    }
    if (password !== confirm) {
      setError(t("Пароли не совпадают."));
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
        title={t("Пароль обновлён")}
        footer={
          <Link to="/login" className="font-bold text-primary">
            {t("Войти с новым паролем")}
          </Link>
        }
      >
        <p className="font-sans text-body text-success">
          {t("Готово. Теперь войди с новым паролем.")}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("Новый пароль")} subtitle={t("Придумай новый пароль для аккаунта.")}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label={t("Новый пароль")}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label={t("Повтори пароль")}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error}
        />
        <Button type="submit" disabled={busy}>
          {busy ? t("Сохраняю…") : t("Сохранить пароль")}
        </Button>
      </form>
    </AuthShell>
  );
}
