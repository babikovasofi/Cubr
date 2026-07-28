// Shared ritual JSX (loading → solve_verify), extracted from SoloPage so the
// tournament ritual (TournamentPage) can reuse the identical calibrate/scramble
// walkthrough/verify/solve_verify machinery against a fixed server scramble. The
// terminal "result" phase stays owned by each PAGE, not this component — solo
// shows ResultScreen (with "Ещё раз" + /solves save status), tournament shows
// TournamentResult (quiet, no re-roll, honesty never surfaced).

import Button from "../components/Button";
import Timer from "../components/Timer";
import CameraStage from "./CameraStage";
import ScrambleWalkthrough from "./ScrambleWalkthrough";
import type { useSoloSession } from "./useSoloSession";
import { verifyMismatchRu } from "../vision/guide";
import { useT } from "../i18n/t";

type Session = ReturnType<typeof useSoloSession>;

export interface SolveRitualProps {
  s: Session;
}

export default function SolveRitual({ s }: SolveRitualProps) {
  const t = useT();
  const { phase } = s.state;

  return (
    <>
      {phase === "loading" ? (
        <LoadingBlock error={s.scrambleError} onRetry={s.regenerateScramble} />
      ) : null}

      {/*
        CameraStage stays MOUNTED across the whole ritual (calibrate through
        solve_verify) — including "walkthrough", where it's only CSS-hidden, not
        unmounted. Unmounting used to destroy the <video> element mid-ritual: the
        live MediaStream stayed bound to the now-detached node (useCamera's Camera
        instance binds to one element for its lifetime and never re-attaches), so
        returning to "verify" mounted a fresh, empty <video> — beige box, frozen
        hand-landmark dots, camera silently dead until a full page reload. `hidden`
        (display:none) does NOT pause video playback/rVFC, unlike DOM removal, so
        the stream and the frame loop survive the walkthrough untouched.
      */}
      {phase !== "loading" && phase !== "result" ? (
        <div
          className={
            phase === "walkthrough" ? "hidden" : "grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]"
          }
        >
          <CameraStage
            videoRef={s.videoRef}
            overlayRef={s.overlayRef}
            workRef={s.workRef}
            error={s.cameraError}
            onRetry={s.startCamera}
          />
          <aside className="flex flex-col gap-4">
            {phase === "calibrate" ? <CalibratePanel s={s} /> : null}
            {phase === "verify" ? <VerifyPanel s={s} /> : null}
            {phase === "armed" ? (
              <StatusPanel
                title={t("Готово к таймеру")}
                body="Поставь обе руки в зелёные зоны и замри — таймер запустится сам. Убрал руки — старт, вернул — стоп."
                timerValue="0.00"
                timerPhase="ready"
              />
            ) : null}
            {phase === "solving" ? (
              <StatusPanel
                title={t("Идёт сборка")}
                body="Собирай! Верни обе руки в зоны и замри — таймер остановится."
                timerValue={s.timerSeconds}
                timerPhase="running"
              />
            ) : null}
            {phase === "stopped" || phase === "solve_verify" ? <SolveVerifyPanel s={s} /> : null}
          </aside>
        </div>
      ) : null}

      {phase === "walkthrough" ? (
        <ScrambleWalkthrough moves={s.moves} onDone={s.gotoVerify} />
      ) : null}
    </>
  );
}

function LoadingBlock({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const t = useT();
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border-2 border-ink bg-surface p-6"
      >
        <p className="max-w-prose font-sans text-body text-danger">
          {t("Не удалось загрузить генератор скрамблов (проверь интернет):")} {error}
        </p>
        <Button onClick={onRetry}>{t("Обновить")}</Button>
      </div>
    );
  }
  return (
    <p className="font-sans text-body text-muted" aria-live="polite">
      {t("Генерирую скрамбл…")}
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

// Calibrate-first (honest start): the SOLVED cube is shown BEFORE the scramble.
// With a selected profile → one white face (quick von-Kries adjust); otherwise a
// full 6-face registration (anon / no profile / a rejected quick-adjust).
function CalibratePanel({ s }: { s: Session }) {
  const t = useT();
  const total = 6;

  if (s.calibrateMode === "quick") {
    const cube = s.selectedCubeName ? `«${s.selectedCubeName}»` : "кубика";
    return (
      <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <h3 className="font-sans text-h3 text-ink">{t("Твой кубик готов")}</h3>
        <p className="font-sans text-small text-muted">
          Cubr уже знает цвета {cube} — можно сразу собирать, показывать его заново не нужно. Если
          сильно поменялся свет — подстрой по одной белой грани.
        </p>
        <Button onClick={s.useSavedProfile}>{t("Использовать сохранённый профиль")}</Button>
        <button
          type="button"
          onClick={s.calibrateStep}
          className="self-start font-sans text-small font-bold text-primary"
        >
          {t("Подстроить под свет (одна белая грань)")}
        </button>
        {s.calibrateError ? (
          <p role="alert" className="font-sans text-small text-danger">
            {s.calibrateError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={s.fallbackToFullCalibration}
          className="self-start font-sans text-small font-bold text-muted"
        >
          {t("Перекалибровать по 6 граням")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{t("Калибровка цветов")}</h3>
      <p className="font-sans text-small text-muted">
        Поднеси к жёлтой рамке грань собранного кубика и снимай по очереди — снято{" "}
        {s.calibrationStep}/{total}.
      </p>
      <Button onClick={s.calibrateStep}>
        Снять грань {Math.min(s.calibrationStep + 1, total)}/{total}
      </Button>
      {s.calibrateError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {s.calibrateError}
        </p>
      ) : null}
    </div>
  );
}

// Honest finish: after the timer freezes, confirm the cube is actually SOLVED
// (ground truth = solved facelets, not the scramble target).
function SolveVerifyPanel({ s }: { s: Session }) {
  const t = useT();
  const total = 6;
  const collecting = s.state.phase === "solve_verify" && s.collecting;
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{t("Проверка сборки")}</h3>
      <Timer value={s.timerSeconds} phase="success" />
      {collecting ? (
        <>
          <p className="font-sans text-small text-muted">
            Держи собранную грань в жёлтой рамке и снимай — прочитано {s.verifyFacesLength}/{total}.
          </p>
          <Button onClick={s.solveVerifyStep}>
            Снять грань {Math.min(s.verifyFacesLength + 1, total)}/{total}
          </Button>
        </>
      ) : (
        <>
          <p className="font-sans text-small text-muted">
            {t("Останови время — покажи 6 граней собранного кубика, я подтвержу сборку.")}
          </p>
          <Button onClick={s.solveVerifyStep}>{t("Подтвердить сборку (6 граней)")}</Button>
        </>
      )}
      {s.solveVerifyError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {s.solveVerifyError}
        </p>
      ) : null}
      {s.solveVerifyFailCount >= 2 ? (
        <>
          <Button onClick={s.skipSolveVerify}>{t("Пропустить")}</Button>
          <p className="font-sans text-caption text-muted">
            {t("Камера не подтвердит сборку — результат сохранится с пометкой «без проверки».")}
          </p>
        </>
      ) : null}
    </div>
  );
}

function VerifyPanel({ s }: { s: Session }) {
  const t = useT();
  const total = 6;

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{t("Проверка сборки")}</h3>
      {s.collecting ? (
        <>
          <p className="font-sans text-small text-muted">
            Держи грань в жёлтой рамке и снимай — прочитано {s.verifyFacesLength}/{total}.
          </p>
          <Button onClick={s.verifyStep}>
            Снять грань {Math.min(s.verifyFacesLength + 1, total)}/{total}
          </Button>
        </>
      ) : (
        <>
          <p className="font-sans text-small text-muted">
            {t(
              "Собери показанный разброс и покажи 6 граней — сверю с эталоном, потом взведу таймер.",
            )}
          </p>
          {!s.canVerify ? (
            <p role="alert" className="font-sans text-small text-danger">
              {t("Эталон скрамбла не готов — обнови скрамбл на экране инструкции.")}
            </p>
          ) : null}
          <Button onClick={s.verifyStep} disabled={!s.canVerify}>
            {t("Проверить сборку (6 граней)")}
          </Button>
        </>
      )}

      {s.state.mismatch ? (
        <p role="alert" className="font-sans text-small text-danger">
          {verifyMismatchRu(s.state.mismatch.face, s.state.mismatch.count, t)}
        </p>
      ) : null}
      {s.verifyError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {s.verifyError}
        </p>
      ) : null}
      {s.verifyFailCount >= 2 ? (
        <>
          <Button onClick={s.skipVerify}>{t("Пропустить")}</Button>
          <p className="font-sans text-caption text-muted">
            {t("Камера не подтвердит скрамбл — таймер взведётся без проверки.")}
          </p>
        </>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={s.backToWalkthrough}
          className="font-sans text-small font-bold text-primary"
        >
          {t("← к инструкции")}
        </button>
      </div>
    </div>
  );
}
