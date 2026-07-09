// Solo solve screen (§5.1 minus opponent). Composes the session orchestrator with
// the camera stage, scramble walkthrough, verify controls, and result screen,
// switching on the pure phase reducer. Everything client-side for Stage 1.2.

import { Link } from "react-router-dom";
import Button from "../components/Button";
import Timer from "../components/Timer";
import CameraStage from "../solo/CameraStage";
import ScrambleWalkthrough from "../solo/ScrambleWalkthrough";
import ResultScreen from "../solo/ResultScreen";
import { useSoloSession } from "../solo/useSoloSession";
import { verifyMismatchRu } from "../vision/guide";

export default function SoloPage() {
  const s = useSoloSession();
  const { phase } = s.state;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-sans text-h2 text-ink">Соло — сборка</h2>
        <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
          ← На главную
        </Link>
      </div>

      {phase === "loading" ? (
        <LoadingBlock
          error={s.scrambleError}
          onRetry={s.regenerateScramble}
        />
      ) : null}

      {phase === "walkthrough" ? (
        <ScrambleWalkthrough moves={s.moves} onDone={s.gotoVerify} />
      ) : null}

      {(phase === "verify" || phase === "armed" || phase === "solving") ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
          <CameraStage
            videoRef={s.videoRef}
            overlayRef={s.overlayRef}
            workRef={s.workRef}
            error={s.cameraError}
            onRetry={s.startCamera}
          />
          <aside className="flex flex-col gap-4">
            {phase === "verify" ? <VerifyPanel s={s} /> : null}
            {phase === "armed" ? (
              <StatusPanel
                title="Готово к таймеру"
                body="Поставь обе руки в зелёные зоны и замри — таймер запустится сам. Убрал руки — старт, вернул — стоп."
                timerValue="0.00"
                timerPhase="ready"
              />
            ) : null}
            {phase === "solving" ? (
              <StatusPanel
                title="Идёт сборка"
                body="Собирай! Верни обе руки в зоны и замри — таймер остановится."
                timerValue={s.timerSeconds}
                timerPhase="running"
              />
            ) : null}
          </aside>
        </div>
      ) : null}

      {phase === "result" ? (
        <ResultScreen seconds={s.timerSeconds} dnf={s.state.dnf} onAgain={s.again} />
      ) : null}
    </div>
  );
}

function LoadingBlock({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border-2 border-ink bg-surface p-6">
        <p className="max-w-prose font-sans text-body text-danger">
          Не удалось загрузить генератор скрамблов (проверь интернет): {error}
        </p>
        <Button onClick={onRetry}>Обновить</Button>
      </div>
    );
  }
  return (
    <p className="font-sans text-body text-muted" aria-live="polite">
      Генерирую скрамбл…
    </p>
  );
}

function StatusPanel({
  title,
  body,
  timerValue,
  timerPhase,
}: {
  title: string;
  body: string;
  timerValue: string;
  timerPhase: "ready" | "running";
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{title}</h3>
      <Timer value={timerValue} phase={timerPhase} />
      <p className="font-sans text-small text-muted">{body}</p>
    </div>
  );
}

type Session = ReturnType<typeof useSoloSession>;

function VerifyPanel({ s }: { s: Session }) {
  const total = 6;

  if (!s.calibrated) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <h3 className="font-sans text-h3 text-ink">Калибровка цветов</h3>
        <p className="font-sans text-small text-muted">
          Поднеси к жёлтой рамке грань собранного кубика и снимай по очереди — снято {s.calibrationStep}/{total}.
        </p>
        <Button onClick={s.captureCalibration}>Снять грань {Math.min(s.calibrationStep + 1, total)}/{total}</Button>
        <button
          type="button"
          onClick={s.backToWalkthrough}
          className="self-start font-sans text-small font-bold text-primary"
        >
          ← вернуться к инструкции
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">Проверка сборки</h3>
      {s.collecting ? (
        <>
          <p className="font-sans text-small text-muted">
            Держи грань в жёлтой рамке и снимай — прочитано {s.verifyFacesLength}/{total}.
          </p>
          <Button onClick={s.verifyStep}>Снять грань {Math.min(s.verifyFacesLength + 1, total)}/{total}</Button>
        </>
      ) : (
        <>
          <p className="font-sans text-small text-muted">
            Собери показанный разброс и покажи 6 граней — сверю с эталоном, потом взведу таймер.
          </p>
          {!s.canVerify ? (
            <p role="alert" className="font-sans text-small text-danger">
              Эталон скрамбла не готов — обнови скрамбл на экране инструкции.
            </p>
          ) : null}
          <Button onClick={s.verifyStep} disabled={!s.canVerify}>
            Проверить сборку (6 граней)
          </Button>
        </>
      )}

      {s.state.mismatch ? (
        <p role="alert" className="font-sans text-small text-danger">
          {verifyMismatchRu(s.state.mismatch.face, s.state.mismatch.count)}
        </p>
      ) : null}
      {s.verifyError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {s.verifyError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={s.recalibrate}
          className="font-sans text-small font-bold text-muted"
        >
          Перекалибровать
        </button>
        <button
          type="button"
          onClick={s.backToWalkthrough}
          className="font-sans text-small font-bold text-primary"
        >
          ← к инструкции
        </button>
      </div>
    </div>
  );
}
