// Dedicated trophy-road screen (owner: "отдельное окно как в brawl stars,
// число кубков сверху"). Route lives under <ProtectedRoute> in App.tsx, same
// tier as /profile — a guest hitting /cups is bounced to /login?next=/cups,
// not left on a broken page.
//
// All numbers ride the same GET /users/me fields CupsRoad already reads
// (`cups`, `cups_rank`, `cups_floor`, `cups_to_next`) — this page adds no
// request of its own and never invents a threshold CupsRoad doesn't also
// know.
//
// Badge board below the road is a placeholder for rank badges that don't
// exist yet — locked slots only, same visual language as the unearned-badge
// spec (§5.7): dashed faint border, "?" mark. Not to be confused with the
// real achievement grid (BadgeGrid.tsx) shown on the profile.

import TrophyIcon from "../components/TrophyIcon";
import CupsRoad, { RANKS } from "../components/CupsRoad";
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

const BADGE_SLOT_COUNT = 8;

export default function CupsPage() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  // Defensive only — ProtectedRoute already keeps anonymous visitors out.
  if (!user) return null;

  const { cups, cups_rank, cups_to_next } = user;
  const atMax = cups_to_next === null;
  const currentIndex = RANKS.findIndex((r) => r.name === cups_rank);
  const currentRank = currentIndex >= 0 ? RANKS[currentIndex] : null;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-sans text-h2 text-ink">{t("Дорога кубков")}</h1>

      <section
        aria-label={t("Кубки: {n}", { n: cups })}
        className="flex flex-col items-center gap-2 rounded-xl border-2 border-ink bg-surface p-6 text-center"
      >
        <TrophyIcon size={56} />
        <span className="font-sans text-[44px] font-black leading-none text-ink [font-variant-numeric:tabular-nums]">
          {cups.toLocaleString("ru-RU")}
        </span>
        {currentRank ? (
          <span className="font-sans text-body font-bold text-muted">{t(currentRank.label)}</span>
        ) : null}
        {atMax ? (
          <p className="mt-1.5 font-sans text-small text-muted">{t("Все рубежи взяты.")}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-sans text-h3 text-ink">{t("Лестница рангов")}</h2>
        <CupsRoad />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-sans text-h3 text-ink">{t("Бейджи дороги")}</h2>
        <p className="font-sans text-small text-muted">
          {t("Появятся по мере прохождения рангов.")}
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8" aria-hidden>
          {Array.from({ length: BADGE_SLOT_COUNT }, (_, i) => (
            <div
              key={i}
              className="flex aspect-square items-center justify-center rounded-tile border-2 border-dashed border-faint bg-surface-2 font-sans text-h3 text-faint"
            >
              ?
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
