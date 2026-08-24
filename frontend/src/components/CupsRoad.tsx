// Лестница рангов кубков (plan: design-fillers). Presentational — reads
// `user` straight from `useAuthStore`, no extra request: `cups`, `cups_rank`,
// `cups_floor`, `cups_to_next` already ride on GET /users/me.
//
// The six rank floors below are a LABEL map only (name → RU label + one
// accent colour for its tiny marker), in the exact order of
// `backend/app/services/cups.py::CUPS_TIERS`. The thresholds themselves —
// which floor a rank starts at, how many cups are left to the next one —
// come from the backend (`cups_floor`/`cups_to_next`) and are never
// recomputed here. If the backend ever reorders or renames a tier, this map
// drifts in label only, never in the numbers a player sees.
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

const RANKS: { name: string; label: string; accent: string; whiteTile?: boolean }[] = [
  { name: "white", label: "Белый", accent: "var(--white)", whiteTile: true },
  { name: "yellow", label: "Жёлтый", accent: "var(--warning)" },
  { name: "green", label: "Зелёный", accent: "var(--success)" },
  { name: "blue", label: "Синий", accent: "var(--primary)" },
  { name: "orange", label: "Оранжевый", accent: "var(--live)" },
  { name: "red", label: "Красный", accent: "var(--danger)" },
];

function RankDot({ accent, whiteTile }: { accent: string; whiteTile?: boolean }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ background: accent, border: whiteTile ? "1.5px solid var(--ink)" : undefined }}
    />
  );
}

export default function CupsRoad() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  const { cups, cups_rank, cups_floor, cups_to_next } = user;
  const atMax = cups_to_next === null;
  const currentIndex = RANKS.findIndex((r) => r.name === cups_rank);
  const nextRank = !atMax && currentIndex >= 0 ? RANKS[currentIndex + 1] : null;

  const span = atMax ? null : cups + (cups_to_next as number) - cups_floor;
  const progress = atMax || span === null || span <= 0 ? 1 : (cups - cups_floor) / span;
  const progressPct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <section
      aria-label={t("Лестница рангов")}
      className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-4.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans text-h3 text-ink">{t("Лестница рангов")}</h2>
        {/* §5.6 бейдж кубков: warning-заливка, ink-обводка, единственный 🏆 в компоненте. */}
        <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-warning px-3 py-1 font-sans text-small font-black text-ink [font-variant-numeric:tabular-nums]">
          🏆 {cups.toLocaleString("ru-RU")}
        </span>
      </div>

      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {RANKS.map((rank, i) => {
          const isCurrent = i === currentIndex;
          const isPast = currentIndex >= 0 && i < currentIndex;
          return (
            <li
              key={rank.name}
              className={
                isCurrent
                  ? "flex items-center gap-3 rounded-md border-2 border-ink bg-primary px-3 py-2 shadow-sticker"
                  : `flex items-center gap-3 rounded-md border border-line px-3 py-2 ${
                      isPast ? "bg-surface-2" : "bg-surface"
                    }`
              }
            >
              <RankDot accent={rank.accent} whiteTile={rank.whiteTile} />
              <span
                className={`font-sans text-small font-bold ${isCurrent ? "text-white" : "text-ink"}`}
              >
                {t(rank.label)}
              </span>
              {/* Порог показываем ТОЛЬКО у текущей ступени, и только тем значением,
                  что прислал бэкенд (`cups_floor`) — своей таблицы порогов тут нет. */}
              {isCurrent ? (
                <span className="ml-auto font-sans text-caption [font-variant-numeric:tabular-nums] text-white">
                  {t("от {n}", { n: cups_floor })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-1.5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
        </div>
        {atMax ? (
          <span className="font-sans text-small text-muted">{t("Все рубежи взяты.")}</span>
        ) : nextRank ? (
          <span className="font-sans text-small text-muted">
            {t("До ранга «{rank}» осталось {n} кубков.", {
              rank: t(nextRank.label),
              n: cups_to_next as number,
            })}
          </span>
        ) : null}
      </div>
    </section>
  );
}
