// Dedicated trophy-road screen (owner: "отдельный красивый экран как в
// brawl stars, число кубков сверху"). Route lives under <ProtectedRoute> in
// App.tsx, same tier as /profile — a guest hitting /cups is bounced to
// /login?next=/cups, not left on a broken page.
//
// All numbers ride the same GET /users/me fields CupsRoad already reads
// (`cups`, `cups_rank`, `cups_floor`, `cups_to_next`) — this page adds no
// request of its own and never invents a threshold CupsRoad doesn't also
// know.

import TrophyIcon from "../components/TrophyIcon";
import CupsRoad, { RANKS } from "../components/CupsRoad";
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

export default function CupsPage() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  // Defensive only — ProtectedRoute already keeps anonymous visitors out.
  if (!user) return null;

  const { cups, cups_rank, cups_floor, cups_to_next } = user;
  const atMax = cups_to_next === null;
  const currentIndex = RANKS.findIndex((r) => r.name === cups_rank);
  const currentRank = currentIndex >= 0 ? RANKS[currentIndex] : null;
  const nextRank = !atMax && currentIndex >= 0 ? RANKS[currentIndex + 1] : null;

  const span = atMax ? null : cups + (cups_to_next as number) - cups_floor;
  const progress = atMax || span === null || span <= 0 ? 1 : (cups - cups_floor) / span;
  const progressPct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-sans text-h2 text-ink">{t("Дорога кубков")}</h1>

      <section
        aria-label={t("Кубки: {n}", { n: cups })}
        className="flex flex-col items-center gap-2 rounded-lg border-2 border-ink bg-surface p-6 text-center"
      >
        <TrophyIcon size={40} className="text-ink" />
        <span className="font-sans text-[40px] font-black leading-none text-ink [font-variant-numeric:tabular-nums]">
          {cups.toLocaleString("ru-RU")}
        </span>
        {currentRank ? (
          <span className="font-sans text-body font-bold text-muted">{t(currentRank.label)}</span>
        ) : null}
        <div className="mt-3 w-full max-w-xs">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
          </div>
          {atMax ? (
            <p className="mt-1.5 font-sans text-small text-muted">{t("Все рубежи взяты.")}</p>
          ) : nextRank ? (
            <p className="mt-1.5 font-sans text-small text-muted">
              {t("До ранга «{rank}» осталось {n} кубков.", {
                rank: t(nextRank.label),
                n: cups_to_next as number,
              })}
            </p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-sans text-h3 text-ink">{t("Лестница рангов")}</h2>
        <CupsRoad />
      </section>
    </div>
  );
}
