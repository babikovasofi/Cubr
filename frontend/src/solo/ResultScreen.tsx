// Solo result: the fixed solve time (or DNF on abort), reusing the Timer's
// success/dnf styling, and an "ещё раз" that regenerates the scramble and restarts
// the cycle without a page reload (the session calls fsm.reset()).

import Button from "../components/Button";
import Timer from "../components/Timer";

interface ResultScreenProps {
  seconds: string; // e.g. "12.34"
  dnf: boolean;
  onAgain: () => void;
}

export default function ResultScreen({ seconds, dnf, onAgain }: ResultScreenProps) {
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
      <Button onClick={onAgain}>Ещё раз</Button>
    </section>
  );
}
