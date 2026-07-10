// /profile (protected). Shows the current user (from authStore), records (best
// single is the only meaningful one in 2.3; ao5 renders as "—"), an editable
// nickname + avatar-URL (PATCH /api/users/me), and solve history (GET /api/solves).

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import { useAuthStore } from "../store/authStore";
import { listSolves, type SolveRead } from "../api/solves";
import { ApiError } from "../api/client";

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(2)} с`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const updateMe = useAuthStore((s) => s.updateMe);

  if (!user) return <Spinner label="Загрузка профиля…" />;

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-center gap-4">
        <Avatar url={user.avatar_url} name={user.nickname ?? user.email} />
        <div className="flex flex-col">
          <h1 className="font-sans text-h2 text-ink">{user.nickname ?? "Без ника"}</h1>
          <span className="font-sans text-small text-muted">{user.email}</span>
          {!user.is_verified ? (
            <span className="font-sans text-small text-warning">Почта не подтверждена</span>
          ) : null}
        </div>
      </header>

      <Records
        best={user.best_single_ms}
        ao5={user.best_ao5_ms}
        cups={user.cups}
      />

      <EditForm
        initialNickname={user.nickname ?? ""}
        initialAvatar={user.avatar_url ?? ""}
        onSave={(nickname, avatar_url) => updateMe({ nickname, avatar_url })}
      />

      <History />
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={`Аватар ${name}`}
        className="h-16 w-16 rounded-full border-2 border-ink object-cover"
      />
    );
  }
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ink bg-surface-2 font-sans text-h2 text-ink"
    >
      {letter}
    </div>
  );
}

function Records({
  best,
  ao5,
  cups,
}: {
  best: number | null;
  ao5: number | null;
  cups: number;
}) {
  const cards: { label: string; value: string }[] = [
    { label: "Лучшая сборка", value: fmtMs(best) },
    { label: "Лучший Ao5", value: ao5 == null ? "—" : fmtMs(ao5) },
    { label: "Кубки", value: String(cups) },
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Рекорды">
      {cards.map((c) => (
        <div key={c.label} className="flex flex-col gap-1 rounded-lg border-2 border-ink bg-surface p-4">
          <span className="font-sans text-overline uppercase text-muted">{c.label}</span>
          <span className="font-sans text-h2 text-ink [font-variant-numeric:tabular-nums]">
            {c.value}
          </span>
        </div>
      ))}
    </section>
  );
}

function EditForm({
  initialNickname,
  initialAvatar,
  onSave,
}: {
  initialNickname: string;
  initialAvatar: string;
  onSave: (nickname: string, avatarUrl: string | null) => Promise<unknown>;
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(nickname.trim(), avatar.trim() || null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить изменения.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6">
      <h2 className="font-sans text-h3 text-ink">Профиль</h2>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Никнейм"
          maxLength={64}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <Input
          label="Ссылка на аватар"
          type="url"
          placeholder="https://…"
          maxLength={512}
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          error={error}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
          {saved ? <span className="font-sans text-small text-success">Сохранено</span> : null}
        </div>
      </form>
    </section>
  );
}

type HistoryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; solves: SolveRead[] };

function History() {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    listSolves(50, 0)
      .then((solves) => alive && setState({ kind: "ok", solves }))
      .catch((e) => {
        if (!alive) return;
        setState({
          kind: "error",
          message: e instanceof ApiError ? e.message : "Не удалось загрузить историю.",
        });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-sans text-h3 text-ink">История сборок</h2>

      {state.kind === "loading" ? <Spinner label="Загружаю историю…" /> : null}

      {state.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{state.message}</p>
          <Button onClick={() => setReloadKey((k) => k + 1)}>Повторить</Button>
        </div>
      ) : null}

      {state.kind === "ok" && state.solves.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-6">
          <p className="font-sans text-body text-muted">
            Пока нет сохранённых сборок. Собери кубик в соло-режиме — результат появится здесь.
          </p>
          <Link to="/solo" className="font-sans text-small font-bold text-primary">
            К соло-тренировке →
          </Link>
        </div>
      ) : null}

      {state.kind === "ok" && state.solves.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-sans text-small">
            <thead>
              <tr className="border-b-2 border-ink text-muted">
                <th className="py-2 pr-4 font-bold">Время</th>
                <th className="py-2 pr-4 font-bold">Статус</th>
                <th className="py-2 font-bold">Когда</th>
              </tr>
            </thead>
            <tbody>
              {state.solves.map((s) => (
                <tr key={s.id} className="border-b border-line">
                  <td className="py-2 pr-4 text-ink [font-variant-numeric:tabular-nums]">
                    {s.status === "dnf" ? "DNF" : fmtMs(s.time_ms)}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-2 text-muted">{fmtDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    valid: { text: "Засчитано", cls: "text-success" },
    dnf: { text: "DNF", cls: "text-danger" },
    rejected: { text: "Отклонено", cls: "text-danger" },
  };
  const m = map[status] ?? { text: status, cls: "text-muted" };
  return <span className={`font-bold ${m.cls}`}>{m.text}</span>;
}
