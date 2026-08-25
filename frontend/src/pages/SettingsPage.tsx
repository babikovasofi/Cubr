// /settings (protected). Account + preferences — split out of ProfilePage
// (plan: profile-settings-split, owner: "просто большой текст с большими
// буквами и категория" was the old /profile). Handle/avatar edit, showcase
// (method + cubing-since year), time-format + chat-email preferences, and
// registered cubes all live here; identity/stats/social stayed on /profile.

import { useEffect, useState, type FormEvent } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import ProfileCard, { CARD_MOTIFS } from "../profile/ProfileCard";
import ShowcaseForm from "../profile/ShowcaseForm";
import HandleField from "../profile/HandleField";
import SegmentedToggle from "../components/SegmentedToggle";
import { getEmailPrefs, updateEmailPrefs } from "../api/email";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import CubeList from "../cubes/CubeList";
import { ApiError } from "../api/client";
import Spinner from "../components/Spinner";
import { useT } from "../i18n/t";

export default function SettingsPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const updateMe = useAuthStore((s) => s.updateMe);

  if (!user) return <Spinner label={t("Загрузка настроек…")} />;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-sans text-h2 text-ink">{t("Настройки")}</h1>

      <ProfileCard title={t("Профиль")} motif={CARD_MOTIFS.records} accent="var(--primary)">
        <EditForm
          initialAvatar={user.avatar_url ?? ""}
          initialHandle={user.handle ?? ""}
          onSave={(avatar_url, handle) => updateMe({ avatar_url, handle })}
        />
      </ProfileCard>

      {/* ShowcaseForm already renders its own titled border-2 card — wrapping
          it again would double the border and duplicate the "Витрина" title
          (card-in-card, the exact thing the canon warns against). */}
      <ShowcaseForm
        initialMethod={user.method}
        initialYear={user.cubing_since_year}
        onSave={(patch) => updateMe(patch)}
      />

      <ProfileCard title={t("Предпочтения")} motif={CARD_MOTIFS.progress} accent="var(--success)">
        <Preferences />
      </ProfileCard>

      {/* CubeList carries its own "Мои кубики" heading — no title here, just
          the shared card border for visual consistency with the rest of the
          page. */}
      <ProfileCard motif={CARD_MOTIFS.history} accent="var(--live)">
        <CubeList />
      </ProfileCard>
    </div>
  );
}

function Preferences() {
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
    <div className="flex flex-col gap-5">
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
    </div>
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
        {saved ? <span className="font-sans text-small text-success">{t("Сохранено")}</span> : null}
      </div>
    </form>
  );
}
