// Онбординг-шаг «Кубки и ранги»: коротко объясняет систему кубков (Brawl
// Stars-style — выиграл дуэль, получил кубки, проиграл — часть отдал) и
// ссылку на /cups, где можно посмотреть всю дорогу рангов. Экран самой
// дороги — CupsPage/CupsRoad — здесь не дублируется, только тизер с
// TrophyIcon и первыми рангами RANKS.

import { Link } from "react-router-dom";
import TrophyIcon from "../components/TrophyIcon";
import { RANKS } from "../components/CupsRoad";
import { useT } from "../i18n/t";

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

      <Link to="/cups" className="self-start font-sans text-small font-bold text-primary underline">
        {t("Открыть дорогу кубков")}
      </Link>
    </div>
  );
}
