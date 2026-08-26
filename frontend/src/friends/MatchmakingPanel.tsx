// Random-opponent matchmaking (friends-hub plan, Этап C). Presentational —
// all the enqueue/poll/cancel logic lives in useMatchmaking. Search state
// uses the design system's own §5.8 "перемешивает" opponent-status pattern
// (3×3 mini-grid, diagonal cells lit, `warning`, chaotic blink) instead of a
// spinner — it's the scramble metaphor already codified for "waiting", not
// a new one invented here.

import { Link } from "react-router-dom";
import Button from "../components/Button";
import MiniGrid from "../components/MiniGrid";
import { useMatchmaking } from "./useMatchmaking";
import { useT } from "../i18n/t";

// §5.8 "перемешивает": diagonal 3 of 9 cells lit.
const SEARCHING_CELLS = [true, false, false, false, true, false, false, false, true];

export default function MatchmakingPanel() {
  const t = useT();
  const { phase, error, existingRoomId, search, cancel } = useMatchmaking();

  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-small text-muted">
        {t("Сразу в дуэль со случайным соперником — без заявки в друзья.")}
      </p>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="font-sans text-small text-danger">{error}</p>
          {existingRoomId ? (
            <Link to={`/duel/${existingRoomId}`}>
              <Button variant="secondary">{t("Перейти к активной дуэли")}</Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      {phase === "idle" ? (
        <Button onClick={() => void search()}>{t("Случайный соперник")}</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 rounded-md border border-line px-3.5 py-2.5">
            <MiniGrid
              accent="var(--warning)"
              cells={SEARCHING_CELLS}
              className="animate-blink-chaos"
            />
            <span className="font-sans text-small font-extrabold text-ink">
              {t("Ищем соперника…")}
            </span>
          </div>
          <Button variant="secondary" onClick={() => void cancel()}>
            {t("Отменить поиск")}
          </Button>
        </div>
      )}
    </div>
  );
}
