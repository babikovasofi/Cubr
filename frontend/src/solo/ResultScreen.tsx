// Solo result: the fixed solve time (or DNF on abort), reusing the Timer's
// success/dnf styling, and an "ещё раз" that regenerates the scramble and restarts
// the cycle without a page reload (the session calls fsm.reset()). Also reflects
// whether the result reached the server (plan §B #8).

import { Link } from "react-router-dom";
import Timer from "../components/Timer";
import type { CardData } from "../share/resultCard";
import ShareCardButton from "../share/ShareCardButton";
import type { SaveState } from "./solveSave";
import NextCard from "./NextCard";
import type { SoloHistory } from "./useSoloHistory";
import { useT } from "../i18n/t";

interface ResultScreenProps {
  seconds: string; // e.g. "12.34"
  dnf: boolean;
  // Elapsed time of THIS solve, ms — raw, not the formatted `seconds` string.
  // Meaningless when `dnf` (a DNF carries no real time). Feeds NextCard's
  // "vs. average/record" comparison (plan: solo-next-card).
  elapsedMs: number;
  // false = seeded profile + one-white-face quick-adjust (casual only). A full
  // 6-face registration is validated=true. Solo is casual now, so a non-validated
  // result is still saved, but flagged honestly (skeptic HIGH#4).
  validated: boolean;
  // false = the tester used "Пропустить" on a verify screen after repeated camera
  // read failures (demo escape hatch) — the result was NOT confirmed by the camera.
  cameraVerified: boolean;
  onAgain: () => void;
  saveState: SaveState;
  // Baseline solve history (before this attempt) for the "what's next" card —
  // see useSoloHistory. Reuses the existing GET /solves, no new endpoint.
  history: SoloHistory;
  // Absent on older/replayed sessions that never threaded a scramble through —
  // the share card is skipped rather than drawn without it (plan: result-share-card).
  scramble?: string;
}

function SaveStatus({ saveState }: { saveState: SaveState }) {
  const t = useT();
  switch (saveState) {
    case "saving":
      return <p className="font-sans text-small text-muted">{t("Сохраняю результат…")}</p>;
    case "saved":
      return (
        <p className="font-sans text-small text-success">{t("Результат сохранён в профиль.")}</p>
      );
    case "anon":
      return (
        <p className="font-sans text-small text-muted">
          <Link to="/login?next=/solo" className="font-bold text-primary">
            {t("Войди")}
          </Link>
          {t(", чтобы сохранять результаты.")}
        </p>
      );
    case "unauthorized":
      return (
        <p role="alert" className="font-sans text-small text-danger">
          {t("Сессия истекла. Результат не потерян —")}{" "}
          <Link to="/login?next=/solo" className="font-bold text-primary">
            {t("войди заново")}
          </Link>
          {t(", чтобы сохранить его.")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="font-sans text-small text-danger">
          {t("Не удалось сохранить результат на сервере.")}
        </p>
      );
    default:
      return null;
  }
}

export default function ResultScreen({
  seconds,
  dnf,
  elapsedMs,
  validated,
  cameraVerified,
  onAgain,
  saveState,
  history,
  scramble,
}: ResultScreenProps) {
  const t = useT();
  const cardData: CardData | null = scramble
    ? {
        kind: "solo",
        timeLabel: seconds,
        dnf,
        scramble,
        dateLabel: new Date().toLocaleDateString("ru-RU"),
      }
    : null;

  return (
    <section className="flex flex-col items-center gap-6 rounded-lg border-2 border-ink bg-surface p-7 text-center">
      <span className="font-sans text-overline uppercase text-muted">
        {dnf ? t("Сбор не засчитан") : t("Твоё время")}
      </span>
      <Timer value={dnf ? "DNF" : seconds} phase={dnf ? "dnf" : "success"} />
      <p className="max-w-prose font-sans text-body text-muted">
        {dnf
          ? t("Руки или кубик пропали из кадра во время сборки. Попробуй ещё раз.")
          : t("Готово! Хочешь ещё разброс — жми кнопку.")}
      </p>
      <SaveStatus saveState={saveState} />
      {!dnf && !cameraVerified ? (
        <p role="alert" className="max-w-prose font-sans text-small text-danger">
          {t("Без проверки камерой: скрамбл/сборка не подтверждены (нажата «Пропустить»).")}
        </p>
      ) : null}
      {!dnf && !validated ? (
        <p className="max-w-prose font-sans text-small text-muted">
          {t(
            "Casual-результат: цвета подстроены по одной белой грани, без полной калибровки. Для рейтинга нужна полная калибровка по 6 граням.",
          )}
        </p>
      ) : null}
      {cardData ? <ShareCardButton data={cardData} /> : null}
      <NextCard dnf={dnf} elapsedMs={elapsedMs} history={history} onAgain={onAgain} />
    </section>
  );
}
