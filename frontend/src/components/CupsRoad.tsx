// Лестница рангов кубков (plan: cups-system). Presentational — reads `user`
// straight from `useAuthStore`, no extra request: `cups`, `cups_rank`,
// `cups_floor`, `cups_to_next` already ride on GET /users/me.
//
// The six rank floors below are a LABEL map only (name → RU label + one
// accent colour for its tiny marker), in the exact order of
// `backend/app/services/cups.py::CUPS_TIERS`. The thresholds themselves —
// which floor a rank starts at, how many cups are left to the next one —
// come from the backend (`cups_floor`/`cups_to_next`) and are never
// recomputed here. If the backend ever reorders or renames a tier, this map
// drifts in label only, never in the numbers a player sees. Because only the
// CURRENT tier's threshold is known client-side, only the current row shows
// a floor value — the others show just their name and marker.
//
// Just the ladder: the big cups count, rank name and progress bar live one
// level up, in CupsPage's hero — this component used to own all of that too,
// but a dedicated /cups screen (owner: "как в brawl stars, число кубков
// сверху") needed the count separate from the road beneath it.
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

  const { cups_rank, cups_floor } = user;
  const currentIndex = RANKS.findIndex((r) => r.name === cups_rank);

  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {RANKS.map((rank, i) => {
        const isCurrent = i === currentIndex;
        const isPast = currentIndex >= 0 && i < currentIndex;
        return (
          <li
            key={rank.name}
            // §5.7: стикер-событие — обводка 2px ink, тень shadow-sticker,
            // фиксированный поворот из набора {−5°,−4°,−2°,3°,4°}. Только
            // текущая ступень — не рабочий элемент, а момент «ты здесь».
            style={isCurrent ? { transform: "rotate(-2deg)" } : undefined}
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
            {isCurrent ? (
              <span className="ml-auto font-sans text-caption [font-variant-numeric:tabular-nums] text-white">
                {t("от {n}", { n: cups_floor })}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
