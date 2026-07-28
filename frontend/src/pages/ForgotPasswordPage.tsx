// /forgot-password — always shows a NEUTRAL confirmation (no account enumeration):
// whether or not the address exists, the user sees the same "если адрес есть…".

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Button from "../components/Button";
import Input from "../components/Input";
import { forgotPassword } from "../api/auth";
import { useT } from "../i18n/t";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
    } catch {
      // Deliberately ignore — the response must not reveal whether the email exists.
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("Сброс пароля")}
      subtitle={t("Укажи почту — пришлём ссылку для сброса.")}
      footer={
        <Link to="/login" className="font-bold text-primary">
          {t("Вернуться ко входу")}
        </Link>
      }
    >
      {sent ? (
        <p className="font-sans text-body text-muted" role="status">
          {t(
            "Если этот адрес зарегистрирован, мы отправили на него ссылку для сброса пароля. Проверь почту.",
          )}
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label={t("Почта")}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t("Отправляю…") : t("Отправить ссылку")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
