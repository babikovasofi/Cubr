// /forgot-password — always shows a NEUTRAL confirmation (no account enumeration):
// whether or not the address exists, the user sees the same "если адрес есть…".

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import AuthShell from "../auth/AuthShell";
import Button from "../components/Button";
import Input from "../components/Input";
import { forgotPassword } from "../api/auth";

export default function ForgotPasswordPage() {
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
      title="Сброс пароля"
      subtitle="Укажи почту — пришлём ссылку для сброса."
      footer={
        <Link to="/login" className="font-bold text-primary">
          Вернуться ко входу
        </Link>
      }
    >
      {sent ? (
        <p className="font-sans text-body text-muted" role="status">
          Если этот адрес зарегистрирован, мы отправили на него ссылку для сброса пароля.
          Проверь почту.
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label="Почта"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Отправляю…" : "Отправить ссылку"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
