// Экран «Дорога кубков» (owner: «отдельное окно как в brawl stars, число
// сверху»). Роут под <ProtectedRoute> в App.tsx — гость уходит на /login.
//
// Все числа берутся из тех же полей GET /users/me, что читает CupsRoad
// (`cups`, `cups_rank`, `cups_floor`, `cups_to_next`) — экран не делает своего
// запроса и не выдумывает порог, которого не знает CupsRoad.
//
// Награды/бейджи пока НЕ рисуем (owner отложил) — экран это: шапка с числом,
// листаемая трасса и полоса прогресса внутри текущего ранга.

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
  const currentIndex = Math.max(
    0,
    RANKS.findIndex((r) => r.name === cups_rank),
  );
  const currentRank = RANKS[currentIndex] ?? null;
  const nextRank = !atMax ? (RANKS[currentIndex + 1] ?? null) : null;
  const fractionWithinRank = atMax
    ? 1
    : Math.min(
        1,
        Math.max(0, (cups - cups_floor) / (cups + (cups_to_next as number) - cups_floor)),
      );
  // Для Белого (color #ffffff) полоса на кремовом фоне не читалась бы — берём line.
  const barColor = currentRank && currentRank.name !== "white" ? currentRank.color : "#ede5d6";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-sans text-h2 text-ink">{t("Дорога кубков")}</h1>

      {/* Шапка: число кубков + мультяшный кубок + текущий ранг. */}
      <section
        aria-label={t("Кубки: {n}", { n: cups })}
        className="flex flex-col items-center gap-2 rounded-3xl border-2 border-ink bg-surface p-5 text-center shadow-sticker sm:p-6"
      >
        <TrophyIcon size={56} />
        <span className="font-sans text-[34px] font-black leading-none text-ink [font-variant-numeric:tabular-nums] sm:text-[46px]">
          {cups.toLocaleString("ru-RU")}
        </span>
        <span className="font-sans text-small text-muted">
          {t("кубков · ранг {rank}", { rank: currentRank ? t(currentRank.label) : "" })}
        </span>
      </section>

      {/* Трасса. */}
      <CupsRoad />

      {/* Прогресс внутри текущего ранга. */}
      {atMax ? (
        <section className="rounded-2xl border-2 border-ink bg-surface p-4 text-center shadow-sticker">
          <p className="font-sans text-body font-black text-ink">{t("Все рубежи взяты.")}</p>
        </section>
      ) : nextRank ? (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-surface p-4 shadow-sticker sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-sans text-body font-black text-ink">
              {t("До ранга {rank}", { rank: t(nextRank.label) })}
            </span>
            <span className="font-sans text-small text-muted [font-variant-numeric:tabular-nums]">
              {t("осталось {n}", { n: cups_to_next })}
            </span>
          </div>
          <div className="h-[18px] w-full overflow-hidden rounded-full border-2 border-ink bg-surface-2 shadow-sticker">
            <div
              className="h-full"
              style={{ width: `${fractionWithinRank * 100}%`, background: barColor }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
