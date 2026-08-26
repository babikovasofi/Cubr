// /profile (protected). Identity + stats + social only — account editing,
// showcase, registered cubes and preferences moved out to /settings
// (plan: profile-settings-split). Shows the current user (from authStore),
// records, badges, goals/coach/progress, solve history, and friends.
//
// Card-based redesign: every section is a titled panel (ProfileCard, §5.5
// canon border-2 ink) instead of bare h2 stacks — the "big text dump" the
// owner flagged in the old layout.

import Spinner from "../components/Spinner";
import BadgeGrid from "../components/BadgeGrid";
import SolveProgressChart from "../components/SolveProgressChart";
import EmptyState from "../components/EmptyState";
import TrophyIcon from "../components/TrophyIcon";
import GoalCard from "../profile/GoalCard";
import CoachCard from "../profile/CoachCard";
import ProfileCard, { CARD_MOTIFS } from "../profile/ProfileCard";
import { currentAo5, AVERAGE_SIZE } from "../profile/average";
import { formatHandle } from "../lib/handle";
import { RANKS } from "../components/CupsRoad";
import Button from "../components/Button";
import { useSolves } from "../lib/useSolves";
import type { SolveRead } from "../api/solves";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { formatSolveMs, type TimeFormat } from "../lib/formatTime";
import { Link } from "react-router-dom";
import { useT } from "../i18n/t";
import type { SolvesState } from "../lib/useSolves";

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
  // Lifted once here: Progress (goal/coach/chart) and History both need the
  // same window of solves — a single fetch, no duplicate GET /api/solves.
  const { state, reload } = useSolves();

  if (!user) return <Spinner label={t("Загрузка профиля…")} />;

  return (
    <div className="flex flex-col gap-5">
      <ProfileHeader user={user} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileCard title={t("Рекорды")} motif={CARD_MOTIFS.records} accent="var(--primary)">
          <Records best={user.best_single_ms} ao5={user.best_ao5_ms} cups={user.cups} />
        </ProfileCard>

        {/* BadgeGrid renders its own "Бейджи" heading — no title here, just
            the shared card border (avoids a duplicated title). */}
        <ProfileCard motif={CARD_MOTIFS.badges} accent="var(--warning)">
          <BadgeGrid />
        </ProfileCard>
      </div>

      <ProfileCard title={t("Прогресс")} motif={CARD_MOTIFS.progress} accent="var(--success)">
        <Progress state={state} />
      </ProfileCard>

      <ProfileCard title={t("История сборок")} motif={CARD_MOTIFS.history} accent="var(--live)">
        <History state={state} reload={reload} />
      </ProfileCard>

      {/* friends-hub plan, Этап A: friends/requests/chat moved to their own
          screen — this card is a short pointer, not a rebuild of that UI. */}
      <ProfileCard motif={CARD_MOTIFS.friends} accent="var(--danger)">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-sans text-small text-muted">
            {t("Друзья, заявки и переписка переехали на отдельный экран.")}
          </p>
          <Link to="/friends">
            <Button variant="secondary">{t("Друзья и сообщения")}</Button>
          </Link>
        </div>
      </ProfileCard>
    </div>
  );
}

// §5.6/§5.11 identity card: avatar tile, handle, cups pill (links to the
// trophy road — owner: "cups everywhere jump to the cups window"), rank
// label, verification notice. Records live in their own card below; this
// header is who-you-are, not what-you've-done.
function ProfileHeader({
  user,
}: {
  user: {
    handle: string | null;
    email: string;
    avatar_url: string | null;
    cups: number;
    cups_rank: string;
    is_verified: boolean;
  };
}) {
  const t = useT();
  const currentRank = RANKS.find((r) => r.name === user.cups_rank) ?? null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-5 shadow-sticker sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-center gap-4">
        <Avatar url={user.avatar_url} name={user.handle ?? user.email} />
        <div className="flex flex-col gap-1">
          <h1 className="font-sans text-h2 text-ink">
            {user.handle ? formatHandle(user.handle) : t("Без ника")}
          </h1>
          <span className="font-sans text-small text-muted">{user.email}</span>
          {!user.handle ? (
            <Link
              to="/settings#profile-handle"
              className="font-sans text-small font-bold text-primary no-underline"
            >
              {t("Задать имя в профиле")}
            </Link>
          ) : null}
          {!user.is_verified ? (
            <span className="font-sans text-small text-warning">{t("Почта не подтверждена")}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3 self-start sm:self-center">
        <CupsBadge cups={user.cups} rankLabel={currentRank ? t(currentRank.label) : null} />
        <Link
          to="/settings"
          className="inline-flex h-11 items-center rounded-full border-2 border-ink bg-surface px-4.5 font-sans text-small font-extrabold text-ink no-underline hover:bg-surface-2"
        >
          {t("Настройки")}
        </Link>
      </div>
    </section>
  );
}

// §5.6 «Бейдж кубков» — обычный вариант: пилюля, фон warning, обводка 2px ink.
// Иконка кубка-с-кубиком (TrophyIcon) вместо эмодзи — единый значок кубков по
// всему приложению. Ведёт на /cups — свой прогресс на дороге рангов.
function CupsBadge({ cups, rankLabel }: { cups: number; rankLabel: string | null }) {
  const t = useT();
  return (
    <Link
      to="/cups"
      aria-label={t("{n} кубков", { n: cups })}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-warning px-3.5 py-1.5 font-sans text-small font-black text-ink no-underline"
    >
      <TrophyIcon size={16} /> {cups}
      {rankLabel ? <span className="font-bold opacity-70">· {rankLabel}</span> : null}
    </Link>
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

// Текущий Ao5 по последним пяти попыткам. Рекорд Ao5 живёт в карточке
// «Рекорды»; здесь — «как я иду прямо сейчас», считается из уже загруженной
// истории (без второго запроса).
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
      <div className="grid gap-4 sm:grid-cols-3">
        <EmptyState
          className="sm:col-span-2"
          title={t("Рекордов пока нет")}
          description={t("Появятся после первой засчитанной сборки в соло-режиме.")}
          ctaLabel={t("К соло-тренировке →")}
          ctaTo="/solo"
        />
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-4">
          <span className="font-sans text-overline uppercase text-muted">{t("Кубки")}</span>
          <span className="font-sans text-h2 text-ink [font-variant-numeric:tabular-nums]">
            {String(cups)}
          </span>
        </div>
      </div>
    );
  }

  const cards: { label: string; value: string }[] = [
    { label: t("Лучшая сборка"), value: fmtMs(best, timeFormat) },
    { label: t("Лучший Ao5"), value: ao5 == null ? "—" : fmtMs(ao5, timeFormat) },
    { label: t("Кубки"), value: String(cups) },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-4"
        >
          <span className="font-sans text-overline uppercase text-muted">{c.label}</span>
          <span className="font-sans text-h2 text-ink [font-variant-numeric:tabular-nums]">
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Цель, коуч, текущий Ao5 и график — все читают «как я иду», в одном порядке:
// цель («куда»), коуч и средняя («что сейчас»), график («как шёл»).
function Progress({ state }: { state: SolvesState }) {
  const t = useT();

  if (state.kind === "loading") return <Spinner label={t("Загружаю историю…")} />;
  if (state.kind === "error")
    return <p className="font-sans text-small text-danger">{state.message}</p>;

  return (
    <div className="flex flex-col gap-4">
      <GoalCard solves={state.solves} />
      <CurrentAverage solves={state.solves} />
      <CoachCard solves={state.solves} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-sans text-body font-bold text-ink">{t("Прогресс времени")}</h3>
          <span className="font-sans text-small text-muted">{t("за последние сборки")}</span>
        </div>
        <SolveProgressChart solves={state.solves} />
      </div>
    </div>
  );
}

function History({ state, reload }: { state: SolvesState; reload: () => void }) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);

  return (
    <div className="flex flex-col gap-4">
      {state.kind === "loading" ? <Spinner label={t("Загружаю историю…")} /> : null}

      {state.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-sans text-small text-danger">{state.message}</p>
          <button
            type="button"
            onClick={reload}
            className="inline-flex h-11 items-center rounded-full border-2 border-ink bg-primary px-4.5 font-sans text-small font-extrabold text-white"
          >
            {t("Повторить")}
          </button>
        </div>
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
    </div>
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
