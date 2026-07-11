// DEV-only Stage-0.3 accuracy screen. Composite: CameraStage (as-is) + the
// accuracy panel, plus the scramble walkthrough in known-scramble mode so the
// tester can reproduce the exact ground-truth scramble on the physical cube.
// Gated behind import.meta.env.DEV at the route level (App.tsx) — never shipped.

import { Link } from "react-router-dom";
import CameraStage from "../solo/CameraStage";
import ScrambleWalkthrough from "../solo/ScrambleWalkthrough";
import Button from "../components/Button";
import AccuracyControls from "./AccuracyControls";
import { useAccuracySession } from "./useAccuracySession";

export default function AccuracyPage() {
  const session = useAccuracySession();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="font-sans text-h2 text-ink">Замер точности зрения (гейт 0.3)</h1>
          <Link to="/" className="font-sans text-small font-bold text-primary no-underline">
            ← На главную
          </Link>
        </div>
        <p className="max-w-prose font-sans text-small text-muted">
          Dev-инструмент. Мерим СЫРОЕ per-sticker чтение классификатора при фиксированном порядке
          захвата и независимом эталоне. Протокол — docs/qa/stage-0.3-vision-accuracy.md.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <CameraStage
            videoRef={session.videoRef}
            overlayRef={session.overlayRef}
            workRef={session.workRef}
            error={session.cameraError}
            onRetry={session.startCamera}
          />
          {!session.cameraStarted ? (
            <Button onClick={session.startCamera}>Включить камеру</Button>
          ) : null}
          {session.mode === "scramble" && session.moves.length > 0 ? (
            <div className="rounded-lg border border-line bg-surface p-3">
              <span className="font-sans text-overline uppercase text-muted">
                Собери этот скрамбл на кубике
              </span>
              <ScrambleWalkthrough
                moves={session.moves}
                onDone={() => {}}
                doneLabel="Скрамбл собран"
              />
            </div>
          ) : null}
        </div>

        <AccuracyControls session={session} />
      </div>
    </div>
  );
}
