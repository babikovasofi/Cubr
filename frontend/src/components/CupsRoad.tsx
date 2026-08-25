// Дорога кубков (plan: cups-system) — горизонтальная листаемая трасса, как в
// Brawl Stars: зарабатываешь кубки → двигаешься по линии → между рубежами
// сидят запертые слоты наград. Presentational — читает `user` из
// `useAuthStore`, без доп. запроса: `cups`, `cups_rank`, `cups_floor`,
// `cups_to_next` уже едут на GET /users/me.
//
// RANKS — только карта меток (name → RU-подпись + акцент маркера) в порядке
// `backend/app/services/cups.py::CUPS_TIERS`. Пороги (пол/остаток) приходят с
// бэкенда и здесь не пересчитываются: прогресс внутри текущего рубежа считаем
// из `cups_floor`/`cups_to_next`, ничего не хардкодим.
//
// `variant="full"` (по умолчанию, экран /cups) — крупные узлы-рубежи + слоты
// наград между ними. `variant="teaser"` — компактная полоска без слотов
// наград, для дашборда.
//
// Трасса скроллится ГОРИЗОНТАЛЬНО внутри собственного контейнера
// (overflow-x-auto + scroll-snap) — страница вбок не едет.
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

export const RANKS: { name: string; label: string; accent: string; whiteTile?: boolean }[] = [
  { name: "white", label: "Белый", accent: "var(--white)", whiteTile: true },
  { name: "yellow", label: "Жёлтый", accent: "var(--warning)" },
  { name: "green", label: "Зелёный", accent: "var(--success)" },
  { name: "blue", label: "Синий", accent: "var(--primary)" },
  { name: "orange", label: "Оранжевый", accent: "var(--live)" },
  { name: "red", label: "Красный", accent: "var(--danger)" },
];

type CupsRoadVariant = "full" | "teaser";

interface CupsRoadProps {
  variant?: CupsRoadVariant;
}

/** Запертый слот награды между рубежами — плейсхолдер, реальные награды не
 * заводим. Замок нарисован вручную (без иконочной либы), мотив 3×3 кубика —
 * четыре точки в углу, по духу мини-сетки §4 дизайн-спека. */
function RewardSlot() {
  return (
    <div className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-faint bg-surface-2">
      <span aria-hidden className="absolute -right-1 -top-1 grid grid-cols-2 gap-[1.5px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-[3px] w-[3px] rounded-[1px]"
            style={{ background: "var(--line)" }}
          />
        ))}
      </span>
      <svg viewBox="0 0 16 16" width={16} height={16} fill="none" aria-hidden>
        <rect
          x={3.5}
          y={7}
          width={9}
          height={6.5}
          rx={1.5}
          stroke="var(--faint)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <path
          d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
          stroke="var(--faint)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export default function CupsRoad({ variant = "full" }: CupsRoadProps) {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  const { cups, cups_rank, cups_floor, cups_to_next } = user;
  const currentIndex = Math.max(
    0,
    RANKS.findIndex((r) => r.name === cups_rank),
  );
  const atMax = cups_to_next === null;
  const tierProgress =
    !atMax && cups_to_next !== null && cups_to_next > 0
      ? Math.min(1, Math.max(0, (cups - cups_floor) / cups_to_next))
      : 1;

  function segmentFill(i: number): number {
    if (currentIndex > i) return 1;
    if (currentIndex === i) return tierProgress;
    return 0;
  }

  const full = variant === "full";
  const trackH = full ? "h-20" : "h-14";
  const nodeW = full ? "w-24" : "w-14";

  return (
    <div className="w-full">
      <div
        className="flex snap-x snap-mandatory items-start gap-0 overflow-x-auto px-2 py-2"
        tabIndex={0}
        role="group"
        aria-label={t("Дорога рангов")}
      >
        {RANKS.map((rank, i) => {
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const filled = isPast || isCurrent;
          const tileSize = full
            ? isCurrent
              ? "h-[76px] w-[76px]"
              : "h-[60px] w-[60px]"
            : isCurrent
              ? "h-12 w-12"
              : "h-9 w-9";

          return (
            <div
              key={rank.name}
              className={`flex ${nodeW} shrink-0 snap-center flex-col items-center`}
              style={{ order: 2 * i }}
            >
              <div className={`relative flex ${trackH} w-full items-center justify-center`}>
                {isCurrent ? (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-0 whitespace-nowrap rounded-full border-2 border-ink bg-primary px-2 py-0.5 font-sans text-[11px] font-extrabold text-white shadow-sticker"
                    style={{ transform: "translateX(-50%) rotate(-4deg)" }}
                  >
                    {t("ты здесь")}
                  </span>
                ) : null}
                <div
                  className={`${tileSize} flex items-center justify-center rounded-tile border-2 border-ink`}
                  style={{
                    background: filled ? rank.accent : "var(--surface)",
                    boxShadow: isCurrent ? "3px 3px 0 var(--ink)" : undefined,
                  }}
                >
                  {rank.whiteTile ? (
                    <span
                      aria-hidden
                      className="h-[70%] w-[70%] rounded-[10px]"
                      style={{ border: "1.5px solid var(--line)" }}
                    />
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex flex-col items-center gap-0.5 text-center">
                <span
                  className={`font-sans text-small ${isCurrent ? "font-extrabold" : "font-bold"} text-ink`}
                >
                  {t(rank.label)}
                </span>
                {isCurrent ? (
                  <span className="font-sans text-caption text-muted [font-variant-numeric:tabular-nums]">
                    {atMax ? t("Все рубежи взяты.") : t("от {n}", { n: cups_floor })}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {full
          ? RANKS.slice(0, -1).map((rank, i) => (
              <div
                key={`segment-after-${rank.name}`}
                className="flex min-w-[64px] flex-1 shrink-0 flex-col items-center"
                style={{ order: 2 * i + 1 }}
              >
                <div className={`relative flex ${trackH} w-full items-center justify-center`}>
                  <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${segmentFill(i) * 100}%` }}
                    />
                  </div>
                  <RewardSlot />
                </div>
                <span aria-hidden className="invisible mt-2 block font-sans text-small">
                  .
                </span>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
