// Terminal panel for the weekly challenge (plan: tournament-ui). One attempt per
// week, recorded once — there is no "Ещё раз" here (unlike solo's ResultScreen)
// and honesty is never surfaced. A DNF uses the QUIET loss treatment from
// design-system §6.3 (surface-2 header strip + ink text, no red slab, no
// opponent-style "Не в этот раз" framing — there's no opponent in this brick).

import Timer from "../components/Timer";
import type { TerminalResult } from "./useTournamentAttempt";

export interface TournamentResultProps {
  result: TerminalResult;
}

export default function TournamentResult({ result }: TournamentResultProps) {
  const { week_label, status, time_ms, forcedLateDnf } = result;
  const dnf = status === "dnf";
  const seconds = time_ms !== null ? (time_ms / 1000).toFixed(2) : "DNF";

  return (
    <section
      className={[
        "flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-surface",
        dnf ? "" : "p-7",
      ].join(" ")}
    >
      {dnf ? (
        <div className="bg-surface-2 px-7 py-3">
          <span className="font-sans text-overline uppercase text-muted">
            Челлендж недели · {week_label}
          </span>
        </div>
      ) : (
        <span className="font-sans text-overline uppercase text-muted">
          Челлендж недели · {week_label}
        </span>
      )}

      <div className={["flex flex-col items-center gap-4 text-center", dnf ? "px-7 pb-7" : ""].join(" ")}>
        <Timer value={dnf ? "DNF" : seconds} phase={dnf ? "dnf" : "success"} />
        <p className="max-w-prose font-sans text-body text-muted">
          {dnf
            ? "Сборка не защитана. Единственная попытка на эту неделю использована."
            : "Результат записан. Единственная попытка на эту неделю использована."}
        </p>
        {forcedLateDnf ? (
          <p className="max-w-prose font-sans text-small text-muted">
            Окно попытки истекло до того, как результат дошёл до сервера — засчитан DNF.
          </p>
        ) : null}
      </div>
    </section>
  );
}
