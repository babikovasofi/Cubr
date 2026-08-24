// /profile (protected). Shows the current user (from authStore), records (best
// single is the only meaningful one in 2.3; ao5 renders as "—"), an editable
// handle + avatar-URL (PATCH /api/users/me), and solve history (GET /api/solves).

import { useEffect, useState, type FormEvent } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import BadgeGrid from "../components/BadgeGrid";
import SolveProgressChart from "../components/SolveProgressChart";
import EmptyState from "../components/EmptyState";
import TrophyIcon from "../components/TrophyIcon";
import GoalCard from "../profile/GoalCard";
import CoachCard from "../profile/CoachCard";
import { currentAo5, AVERAGE_SIZE } from "../profile/average";
import ShowcaseForm from "../profile/ShowcaseForm";
import HandleField from "../profile/HandleField";
import { formatHandle } from "../lib/handle";
import SegmentedToggle from "../components/SegmentedToggle";
import { getEmailPrefs, updateEmailPrefs } from "../api/email";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import CubeList from "../cubes/CubeList";
import FriendsSection from "../friends/FriendsSection";
import { useSolves } from "../lib/useSolves";
import type { SolveRead } from "../api/solves";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

function fmtMs(ms: number | null, format: TimeFormat): string {
  if (ms == null) return "—";
  return formatSolveMs(ms, format);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export default function ProfilePage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const updateMe = useAuthStore((s) => s.updateMe);

  if (!user) return <Spinner label={t("Загрузка профиля…")} />;

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-center gap-4">
        <Avatar url={user.avatar_url} name={user.handle ?? user.email} />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-sans text-h2 text-ink">
              {user.handle ? formatHandle(user.handle) : t("Без ника")}
            </h1>
            <CupsBadge cups={user.cups} />
          </div>
          <span className="font-sans text-small text-muted">{user.email}</span>
          {!user.handle ? (
            <a
              href="#profile-handle"
              className="font-sans text-small font-bold text-primary no-underline"
            >
              {t("Задать имя в профиле")}
            </a>
          ) : null}
          {!user.is_verified ? (
            <span className="font-sans text-small text-warning">{t("Почта не подтверждена")}</span>
          ) : null}
        </div>
      </header>

      <Records best={user.best_single_ms} ao5={user.best_ao5_ms} cups={user.cups} />

      <BadgeGrid />

      <History />

      <CubeList />

      <FriendsSection />

      <ShowcaseForm
        initialMethod={user.method}
        initialYear={user.cubing_since_year}
        onSave={(patch) => updateMe(patch)}
      />

      <EditForm
        initialAvatar={user.avatar_url ?? ""}
        initialHandle={user.handle ?? ""}
        onSave={(avatar_url, handle) => updateMe({ avatar_url, handle })}
      />

      <SettingsSection />
    </div>
  );
}

// §5.6 «Бейдж кубков» — обычный вариант: пилюля, фон warning, обводка 2px ink.
// Иконка кубка-с-кубиком (TrophyIcon) вместо эмодзи — единый значок кубков по
// всему приложению.
function CupsBadge({ cups }: { cups: number }) {
  const t = useT();
  return (
    <span
      aria-label={t("{n} кубков", { n: cups })}
      className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-warning px-3 py-1 font-sans text-small font-black text-ink [font-variant-numeric:tabular-nums]"
    >
      <TrophyIcon size={16} /> {cups}
    </span>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const t = useT();
  if (url) {
    return (
      <img
        src={url}
        alt={t("Аватар {name}", { name })}
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

// Текущий Ao5 по последним пяти попыткам. Рекорд Ao5 живёт в карточках выше и
// приходит с сервера; здесь — «как я иду прямо сейчас», считается из уже
// загруженной истории (без второго запроса).
function CurrentAverage({ solves }: { solves: SolveRead[] }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const value = currentAo5(solves);
  return (
    <p className="font-sans text-small text-muted">
      {t("Текущий Ao5 (последние {n} попыток):", { n: AVERAGE_SIZE })}{" "}
      <span className="font-bold text-ink">
        {value === null ? t("пока нет") : formatSolveMs(value, timeFormat)}
      </span>
    </p>
  );
}

function Records({ best, ao5, cups }: { best: number | null; ao5: number | null; cups: number }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);

  // Секционная пустота: без единой засчитанной сборки «Лучшая сборка» и
  // «Лучший Ao5» — оба гарантированно «—». Кубки всё равно свои (дуэли их
  // начисляют без соло-сборок), поэтому та карточка остаётся.
  if (best === null) {
    return (
      <section className="grid gap-4 sm:grid-cols-3" aria-label={t("Рекорды")}>
        <EmptyState
          className="sm:col-span-2"
          title={t("Рекордов пока нет")}
          description={t("Появятся после первой засчитанной сборки в соло-режиме.")}
          ctaLabel={t("К соло-тренировке →")}
          ctaTo="/solo"
        />
        <div className="flex flex-col gap-1 rounded-lg border-2 border-ink bg-surface p-4">
          <span className="font-sans text-overline uppercase text-muted">{t("Кубки")}</span>
          <span className="font-sans text-h2 text-ink [font-variant-numeric:tabular-nums]">
            {String(cups)}
          </span>
        </div>
      </section>
    );
  }

  const cards: { label: string; value: string }[] = [
    { label: t("Лучшая сборка"), value: fmtMs(best, timeFormat) },
    { label: t("Лучший Ao5"), value: ao5 == null ? "—" : fmtMs(ao5, timeFormat) },
    { label: t("Кубки"), value: String(cups) },
  ];
  return (
    <section className="grid gap-4 sm:grid-cols-3" aria-label={t("Рекорды")}>
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-1 rounded-lg border-2 border-ink bg-surface p-4"
        >
          <span className="font-sans text-overline uppercase text-muted">{c.label}</span>
          <span className="font-sans text-h2 text-ink [font-variant-numeric:tabular-nums]">
            {c.value}
          </span>
        </div>
      ))}
    </section>
  );
}

function SettingsSection() {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const setTimeFormat = useSettingsStore((s) => s.setTimeFormat);
  // Пример времени прямо в подписи: «мм:сс» и «секунды» на словах различают
  // хуже, чем 1:23.45 против 83.45.
  const options: { value: TimeFormat; label: string }[] = [
    { value: "clock", label: `${t("Минуты : секунды")} · ${formatSolveMs(83450, "clock")}` },
    { value: "seconds", label: `${t("Секунды")} · ${formatSolveMs(83450, "seconds")}` },
  ];
  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6">
      <h2 className="font-sans text-h3 text-ink">{t("Настройки")}</h2>
      <div className="flex flex-col gap-2">
        <span className="font-sans text-small font-bold text-ink">{t("Формат времени")}</span>
        <SegmentedToggle<TimeFormat>
          value={timeFormat}
          onChange={setTimeFormat}
          label={t("Формат времени")}
          options={options}
          className="self-start"
        />
      </div>
      <ChatEmailToggle />
    </section>
  );
}

type ChatEmailState =
  { kind: "loading" } | { kind: "error" } | { kind: "ready"; enabled: boolean; saving: boolean };

// GET/PUT /api/email/prefs (swarm-report/friend-chat-plan.md §7 "Этап B").
// Same load/error/ready dance as useSolves — no store for this, it's a single
// screen and a single value, so a local hook is enough.
function ChatEmailToggle() {
  const t = useT();
  const [state, setState] = useState<ChatEmailState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    getEmailPrefs()
      .then((prefs) => {
        if (alive) setState({ kind: "ready", enabled: prefs.chat_email_enabled, saving: false });
      })
      .catch(() => {
        if (alive) setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const options: { value: "on" | "off"; label: string }[] = [
    { value: "on", label: t("Включены") },
    { value: "off", label: t("Выключены") },
  ];

  async function onChange(next: "on" | "off") {
    if (state.kind !== "ready") return;
    const enabled = next === "on";
    const prev = state.enabled;
    setState({ kind: "ready", enabled, saving: true });
    try {
      await updateEmailPrefs({ chat_email_enabled: enabled });
      setState({ kind: "ready", enabled, saving: false });
    } catch {
      // Revert on failure — no toast here, the segmented control snapping
      // back to the previous value already tells the story.
      setState({ kind: "ready", enabled: prev, saving: false });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-small font-bold text-ink">
        {t("Письма о новых сообщениях от друзей")}
      </span>
      <p className="font-sans text-small text-muted">
        {t(
          "Если ты давно не заходил на сайт, а друг тебе написал, пришлём письмо — не чаще раза в час и без текста сообщения.",
        )}
      </p>
      {state.kind === "loading" ? (
        <span className="font-sans text-small text-muted">{t("Загружаю настройку писем…")}</span>
      ) : null}
      {state.kind === "error" ? (
        <span role="alert" className="font-sans text-small text-danger">
          {t("Не удалось загрузить настройку писем.")}
        </span>
      ) : null}
      {state.kind === "ready" ? (
        <SegmentedToggle<"on" | "off">
          value={state.enabled ? "on" : "off"}
          onChange={(v) => void onChange(v)}
          label={t("Письма о новых сообщениях от друзей")}
          options={options}
          className="self-start"
        />
      ) : null}
    </div>
  );
}

function EditForm({
  initialAvatar,
  initialHandle,
  onSave,
}: {
  initialAvatar: string;
  initialHandle: string;
  onSave: (avatarUrl: string | null, handle: string | null) => Promise<unknown>;
}) {
  const t = useT();
  const [avatar, setAvatar] = useState(initialAvatar);
  const [handle, setHandle] = useState(initialHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(avatar.trim() || null, handle.trim() || null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Не удалось сохранить изменения."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6">
      <h2 className="font-sans text-h3 text-ink">{t("Профиль")}</h2>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label={t("Ссылка на аватар")}
          type="url"
          placeholder="https://…"
          maxLength={512}
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
        />
        <HandleField id="profile-handle" value={handle} onChange={setHandle} error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? t("Сохраняю…") : t("Сохранить")}
          </Button>
          {saved ? (
            <span className="font-sans text-small text-success">{t("Сохранено")}</span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function History() {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const { state, reload } = useSolves();

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-sans text-h3 text-ink">{t("История сборок")}</h2>

      {state.kind === "loading" ? <Spinner label={t("Загружаю историю…")} /> : null}

      {state.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{state.message}</p>
          <Button onClick={reload}>{t("Повторить")}</Button>
        </div>
      ) : null}

      {/* Цель — над графиком: она отвечает «куда я иду», график — «как шёл». */}
      {state.kind === "ok" ? <GoalCard solves={state.solves} /> : null}

      {state.kind === "ok" ? <CurrentAverage solves={state.solves} /> : null}

      {/* Коуч — тоже текстовый вывод перед графиком, тем же порядком, что и цель:
          сначала «что это значит», потом визуализация «как это выглядело». */}
      {state.kind === "ok" ? <CoachCard solves={state.solves} /> : null}

      {state.kind === "ok" ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-sans text-h3 text-ink">{t("Прогресс времени")}</h2>
            <span className="font-sans text-small text-muted">{t("за последние сборки")}</span>
          </div>
          <SolveProgressChart solves={state.solves} />
        </section>
      ) : null}

      {state.kind === "ok" && state.solves.length === 0 ? (
        <EmptyState
          title={t(
            "Пока нет сохранённых сборок. Собери кубик в соло-режиме — результат появится здесь.",
          )}
          ctaLabel={t("К соло-тренировке →")}
          ctaTo="/solo"
        />
      ) : null}

      {state.kind === "ok" && state.solves.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-sans text-small">
            <thead>
              <tr className="border-b-2 border-ink text-muted">
                <th className="py-2 pr-4 font-bold">{t("Время")}</th>
                <th className="py-2 pr-4 font-bold">{t("Статус")}</th>
                <th className="py-2 font-bold">{t("Когда")}</th>
              </tr>
            </thead>
            <tbody>
              {state.solves.map((s) => (
                <tr key={s.id} className="border-b border-line">
                  <td className="py-2 pr-4 text-ink [font-variant-numeric:tabular-nums]">
                    {s.status === "dnf" ? "DNF" : fmtMs(s.time_ms, timeFormat)}
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
  const t = useT();
  const map: Record<string, { text: string; cls: string }> = {
    valid: { text: t("Засчитано"), cls: "text-success" },
    dnf: { text: "DNF", cls: "text-danger" },
    rejected: { text: t("Отклонено"), cls: "text-danger" },
  };
  const m = map[status] ?? { text: status, cls: "text-muted" };
  return <span className={`font-bold ${m.cls}`}>{m.text}</span>;
}
