// Solo solve screen (§5.1 minus opponent). Composes the session orchestrator with
// the shared ritual (SolveRitual) and the result screen, switching on the pure
// phase reducer. Everything client-side for Stage 1.2.

import { Link } from "react-router-dom";
import CubeSelect from "../cubes/CubeSelect";
import ResultScreen from "../solo/ResultScreen";
import SolveRitual from "../solo/SolveRitual";
import { useSoloSession } from "../solo/useSoloSession";

export default function SoloPage() {
  const s = useSoloSession();
  const { phase } = s.state;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-sans text-h2 text-ink">Соло — сборка</h2>
        <div className="flex items-center gap-4">
          <CubeSelect />
          <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
            ← На главную
          </Link>
        </div>
      </div>

      <SolveRitual s={s} />

      {phase === "result" ? (
        <ResultScreen
          seconds={s.timerSeconds}
          dnf={s.state.dnf}
          validated={s.validated}
          cameraVerified={s.state.cameraVerified}
          onAgain={s.again}
          saveState={s.saveState}
          scramble={s.scramble}
        />
      ) : null}
    </div>
  );
}
