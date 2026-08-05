// Solo result: the fixed solve time (or DNF on abort), reusing the Timer's
// success/dnf styling, and an "ещё раз" that regenerates the scramble and restarts
// the cycle without a page reload (the session calls fsm.reset()). Also reflects
// whether the result reached the server (plan §B #8).

import { Link } from "react-router-dom";
import Button from "../components/Button";
import Timer from "../components/Timer";
import type { CardData } from "../share/resultCard";
import ShareCardButton from "../share/ShareCardButton";
import type { SaveState } from "./solveSave";
import { useT } from "../i18n/t";

interface ResultScreenProps {
  seconds: string; // e.g. "12.34"
  dnf: boolean;
  // false = seeded profile + one-white-face quick-adjust (casual only). A full
  // 6-face registration is validated=true. Solo is casual now, so a non-validated
  // result is still saved, but flagged honestly (skeptic HIGH#4).
  validated: boolean;
  // false = the tester used "Пропустить" on a verify screen after repeated camera
  // read failures (demo escape hatch) — the result was NOT confirmed by the camera.
  cameraVerified: boolean;
  onAgain: () => void;
  saveState: SaveState;
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
          Сессия истекла. Результат не потерян —{" "}
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
  validated,
  cameraVerified,
  onAgain,
  saveState,
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
          ? "Руки или кубик пропали из кадра во время сборки. Попробуй ещё раз."
          : "Готово! Хочешь ещё разброс — жми кнопку."}
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
      <Button onClick={onAgain}>{t("Ещё раз")}</Button>
      {cardData ? <ShareCardButton data={cardData} /> : null}
    </section>
  );
}
