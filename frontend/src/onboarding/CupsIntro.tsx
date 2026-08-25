// Онбординг-шаг «Кубки и ранги»: объясняет систему кубков и её политику
// (числа — из backend/app/services/cups.py: победа +10…+5, поражение 0…−10 по
// рангам, ничья обоим +2) и показывает лесенку рангов от белого к красному.
// Ссылки на /cups здесь НЕТ намеренно: она уводила из онбординга, а дорогу
// человек и так увидит сразу после (кубок в шапке ведёт на /cups).

import TrophyIcon from "../components/TrophyIcon";
import { RANKS } from "../components/CupsRoad";
import { useT } from "../i18n/t";

// Политика начисления (owner spec, зеркало cups.py). Показываем диапазоном по
// рангам, а не таблицей на шесть строк — человеку на онбординге важен принцип.
const POLICY: { accent: string; label: string; value: string }[] = [
  { accent: "var(--success)", label: "Победа", value: "+10…+5" },
  { accent: "var(--danger)", label: "Поражение", value: "0…−10" },
  { accent: "var(--warning)", label: "Ничья", value: "+2 обоим" },
];

export default function CupsIntro() {
  const t = useT();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-lg border-2 border-ink bg-surface p-4.5">
        <TrophyIcon size={40} />
        <p className="font-sans text-body text-ink">
          {t(
            "Выиграл дуэль — получил кубки. Проиграл — часть кубков ушла сопернику. Побеждай стабильно — поднимайся по рангам.",
          )}
        </p>
      </div>

      {/* Политика: сколько +/− и за ничью. Чем выше ранг, тем меньше даёт
          победа и больше отнимает поражение — на старте (белый) не теряешь. */}
      <div className="flex flex-col gap-2">
        <span className="font-sans text-small font-black text-ink">{t("Сколько кубков")}</span>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {POLICY.map((row) => (
            <li
              key={row.label}
              className="flex items-center justify-between gap-2 rounded-md border-2 border-ink bg-surface px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-sm border border-ink"
                  style={{ background: row.accent }}
                />
                <span className="font-sans text-small font-bold text-ink">{t(row.label)}</span>
              </span>
              <span className="font-sans text-small font-black text-ink [font-variant-numeric:tabular-nums]">
                {row.value}
              </span>
            </li>
          ))}
        </ul>
        <span className="font-sans text-caption text-muted">
          {t(
            "Чем выше ранг, тем меньше даёт победа и больше отнимает поражение. На старте не теряешь.",
          )}
        </span>
      </div>

      {/* Ранги — от белого к красному. */}
      <div className="flex flex-col gap-2">
        <span className="font-sans text-small font-black text-ink">
          {t("Ранги — от белого к красному")}
        </span>
        <ol className="flex flex-wrap items-center gap-2" aria-label={t("Дорога рангов")}>
          {RANKS.map((rank) => (
            <li
              key={rank.name}
              className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-surface px-2.5 py-1"
            >
              <span
                aria-hidden
                className="h-3 w-3 rounded-full border border-ink"
                style={{ background: rank.color }}
              />
              <span className="font-sans text-caption font-black text-ink">{t(rank.label)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
