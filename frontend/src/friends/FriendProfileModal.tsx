// Friend profile dialog (owner: "возможность посмотреть профиль друга").
// Opened from a friend row; loads the friends-only profile (cups/rank, best
// times, showcase) via getFriendProfile — gated server-side on an accepted
// friendship. A plain accessible overlay (no Modal primitive exists yet in
// components/): role="dialog" + Esc + backdrop click to close, focus moved
// to the panel on open. `online`/`displayName` come from the calling row so
// the header renders instantly while the rest loads.

import { useEffect, useRef, useState } from "react";
import Spinner from "../components/Spinner";
import TrophyIcon from "../components/TrophyIcon";
import { RANKS } from "../components/CupsRoad";
import { METHOD_SHORT_LABELS } from "../profile/ShowcaseForm";
import PresenceAvatar from "./PresenceAvatar";
import { getFriendProfile, type FriendProfile } from "../api/friends";
import { ApiError } from "../api/client";
import { formatHandle } from "../lib/handle";
import { formatSolveMs } from "../lib/formatTime";
import { useSettingsStore } from "../store/settingsStore";
import type { SolvingMethod } from "../api/auth";
import { useT } from "../i18n/t";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3.5 py-2.5">
      <span className="font-sans text-caption uppercase tracking-wide text-muted">{label}</span>
      <span className="font-sans text-body font-bold text-ink [font-variant-numeric:tabular-nums]">
        {value}
      </span>
    </div>
  );
}

export default function FriendProfileModal({
  friendshipId,
  displayName,
  online,
  onClose,
}: {
  friendshipId: string;
  displayName: string;
  online: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    getFriendProfile(friendshipId, controller.signal)
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch((e: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(e instanceof ApiError ? t(e.message) : t("Не удалось загрузить профиль."));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [friendshipId]);

  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rank = profile ? (RANKS.find((r) => r.name === profile.cups_rank) ?? null) : null;
  const dash = "—";
  const method =
    profile?.method && profile.method in METHOD_SHORT_LABELS
      ? METHOD_SHORT_LABELS[profile.method as SolvingMethod]
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Профиль игрока")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-5 shadow-sticker outline-none sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PresenceAvatar displayName={displayName} online={online} size={56} />
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate font-sans text-h3 text-ink">{formatHandle(displayName)}</h2>
              <span
                className={`font-sans text-small ${online ? "text-success" : "text-muted"}`}
              >
                {online ? t("в сети") : t("не в сети")}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Закрыть")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface font-sans text-body font-black text-ink hover:bg-surface-2"
          >
            ✕
          </button>
        </div>

        {error ? (
          <p role="alert" className="font-sans text-small text-danger">
            {error}
          </p>
        ) : !profile ? (
          <Spinner label={t("Загружаю профиль…")} />
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border-2 border-ink bg-warning px-3.5 py-2">
              <TrophyIcon size={18} className="text-ink" />
              <span className="font-sans text-body font-black text-ink [font-variant-numeric:tabular-nums]">
                {profile.cups.toLocaleString("ru-RU")}
              </span>
              {rank ? (
                <span className="font-sans text-small font-bold text-ink opacity-80">
                  · {t(rank.label)}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Stat
                label={t("Лучшее время")}
                value={
                  profile.best_single_ms !== null
                    ? formatSolveMs(profile.best_single_ms, timeFormat)
                    : dash
                }
              />
              <Stat
                label={t("Лучший Ao5")}
                value={
                  profile.best_ao5_ms !== null
                    ? formatSolveMs(profile.best_ao5_ms, timeFormat)
                    : dash
                }
              />
              <Stat label={t("Метод")} value={method ?? dash} />
              <Stat
                label={t("Собирает с")}
                value={profile.cubing_since_year ? String(profile.cubing_since_year) : dash}
              />
            </div>

            <p className="font-sans text-small text-muted">
              {t("В друзьях с")}{" "}
              {new Date(profile.friends_since).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
