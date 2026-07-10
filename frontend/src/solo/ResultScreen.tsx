// Solo result: the fixed solve time (or DNF on abort), reusing the Timer's
// success/dnf styling, and an "ещё раз" that regenerates the scramble and restarts
// the cycle without a page reload (the session calls fsm.reset()). Also reflects
// whether the result reached the server (plan §B #8).

import { Link } from "react-router-dom";
import Button from "../components/Button";
import Timer from "../components/Timer";
import type { SaveState } from "./solveSave";

interface ResultScreenProps {
  seconds: string; // e.g. "12.34"
  dnf: boolean;
  onAgain: () => void;
  saveState: SaveState;
}

function SaveStatus({ saveState }: { saveState: SaveState }) {
  switch (saveState) {
    case "saving":
      return <p className="font-sans text-small text-muted">Сохраняю результат…</p>;
    case "saved":
      return <p className="font-sans text-small text-success">Результат сохранён в профиль.</p>;
    case "anon":
      return (
        <p className="font-sans text-small text-muted">
          <Link to="/login?next=/solo" className="font-bold text-primary">
            Войди
          </Link>
          , чтобы сохранять результаты.
        </p>
      );
    case "unauthorized":
      return (
        <p role="alert" className="font-sans text-small text-danger">
          Сессия истекла. Результат не потерян —{" "}
          <Link to="/login?next=/solo" className="font-bold text-primary">
            войди заново
          </Link>
          , чтобы сохранить его.
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="font-sans text-small text-danger">
          Не удалось сохранить результат на сервере.
        </p>
      );
    default:
      return null;
  }
}

export default function ResultScreen({ seconds, dnf, onAgain, saveState }: ResultScreenProps) {
  return (
    <section className="flex flex-col items-center gap-6 rounded-lg border-2 border-ink bg-surface p-7 text-center">
      <span className="font-sans text-overline uppercase text-muted">
        {dnf ? "Сбор не засчитан" : "Твоё время"}
      </span>
      <Timer value={dnf ? "DNF" : seconds} phase={dnf ? "dnf" : "success"} />
      <p className="max-w-prose font-sans text-body text-muted">
        {dnf
          ? "Руки или кубик пропали из кадра во время сборки. Попробуй ещё раз."
          : "Готово! Хочешь ещё разброс — жми кнопку."}
      </p>
      <SaveStatus saveState={saveState} />
      <Button onClick={onAgain}>Ещё раз</Button>
    </section>
  );
}
