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
import { facePrompt, facePromptFor, SOLO_FACE_ORDER, type SoloFace } from "./facePrompts";

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
          <div className="flex flex-col gap-3">
            <CameraStage
              videoRef={s.videoRef}
              overlayRef={s.overlayRef}
              workRef={s.workRef}
              error={s.cameraError}
              onRetry={s.startCamera}
            />
            {/* Явная кнопка на случай, если авто-старт камеры не сработал
                (пермишн, нужен жест) — иначе в челлендже/скрамбле дня камеру
                нечем запустить, и «точки не горят». */}
            {!s.cameraStarted ? (
              <Button onClick={() => void s.startCamera()}>{t("Включить камеру")}</Button>
            ) : null}
          </div>
          <aside className="flex flex-col gap-4">
            {phase === "calibrate" ? <CalibratePanel s={s} /> : null}
            {phase === "verify" ? <VerifyPanel s={s} /> : null}
            {phase === "armed" ? (
              <StatusPanel
                title={t("Готово к таймеру")}
                body="Поставь обе руки в зелёные зоны и замри — таймер запустится сам. Убрал руки — старт, вернул — стоп."
                timerValue="0.00"
                timerPhase="ready"
                signals={s.signals}
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

function ReadyChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 font-sans text-caption font-black",
        on ? "border-ink bg-success text-white" : "border-line bg-surface-2 text-muted",
      ].join(" ")}
    >
      {on ? "✓" : "○"} {label}
    </span>
  );
}

function StatusPanel({
  title,
  body,
  timerValue,
  timerPhase,
  signals,
}: {
  title: string;
  body: string;
  timerValue: string;
  timerPhase: "ready" | "running";
  signals?: { handsDetected: boolean; bothInZone: boolean; still: boolean; ready: boolean };
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{title}</h3>
      <Timer value={timerValue} phase={timerPhase} />
      {signals ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <ReadyChip on={signals.handsDetected} label={t("руки видны")} />
            <ReadyChip on={signals.bothInZone} label={t("обе в зоне")} />
            <ReadyChip on={signals.still} label={t("замер")} />
          </div>
          <p
            className={`font-sans text-small font-bold ${signals.ready ? "text-success" : "text-muted"}`}
          >
            {signals.ready
              ? t("Готово — убирай руки, чтобы стартовать!")
              : t("Обе кисти в зелёные зоны и замри…")}
          </p>
        </div>
      ) : null}
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
    // Два ключа, а не один с подстановкой «кубика».
    //
    // Строка с именем и строка без него — разные предложения, а не одно с
    // дыркой: подставлять слово-заглушку в шаблон значит переводить её вместе с
    // шаблоном и получать «Cubr already knows the colours of кубика».
    const named = s.selectedCubeName;
    return (
      <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
        <h3 className="font-sans text-h3 text-ink">{t("Твой кубик готов")}</h3>
        <p className="font-sans text-small text-muted">
          {named
            ? t(
                "Cubr уже знает цвета «{cube}» — можно сразу собирать, показывать его заново не нужно. Если сильно поменялся свет — подстрой по одной белой грани.",
                { cube: named },
              )
            : t(
                "Cubr уже знает цвета твоего кубика — можно сразу собирать, показывать его заново не нужно. Если сильно поменялся свет — подстрой по одной белой грани.",
              )}
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
        {t(
          "Поднеси к жёлтой рамке грань собранного кубика и снимай по очереди — снято {done}/{total}.",
          { done: s.calibrationStep, total },
        )}
      </p>
      <FaceHint step={s.calibrationStep} solved />
      <Button onClick={s.calibrateStep}>
        {t("Снять грань {n}/{total}", { n: Math.min(s.calibrationStep + 1, total), total })}
      </Button>
      {s.calibrateError ? (
        <p role="alert" className="font-sans text-small text-danger">
          {s.calibrateError}
        </p>
      ) : null}
    </div>
  );
}

/** Первая ещё не снятая грань в порядке-совете URFDLB — та, что показываем
 * следующей: и при чистом старте (все шесть пустые), и после того как одна
 * грань выбита из коллектора пересъёмкой (только она и осталась пустой). */
function nextFaceToShow(captured: readonly string[]): SoloFace | null {
  return SOLO_FACE_ORDER.find((f) => !captured.includes(f)) ?? null;
}

/**
 * Какую грань нести к рамке на этом шаге.
 *
 * Порядок — совет: грань узнаётся по центру, поэтому чтение переживёт любой
 * порядок показа. Об этом сказано прямо, чтобы человек не переснимал всё
 * заново, сбившись с круга; а вот показать одну грань дважды нельзя — тогда
 * шесть съёмок не разложатся по шести цветам.
 */
function FaceHint({ step, solved }: { step: number; solved: boolean }) {
  const t = useT();
  const prompt = facePrompt(step, solved);
  if (!prompt) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-sans text-body font-extrabold text-ink">{t(prompt)}</p>
      <p className="font-sans text-caption text-muted">
        {t("Порядок не строгий — грань узнаётся по центру. Главное, не показывать одну дважды.")}
      </p>
    </div>
  );
}

// Honest finish: after the timer freezes, confirm the cube is actually SOLVED
// (ground truth = solved facelets, not the scramble target).
function SolveVerifyPanel({ s }: { s: Session }) {
  const t = useT();
  const total = 6;
  const collecting = s.state.phase === "solve_verify" && s.collecting;
  const nextFace = nextFaceToShow(s.verifyCapturedFaces);
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{t("Проверка сборки")}</h3>
      <Timer value={s.timerSeconds} phase="success" />
      {collecting ? (
        <>
          <p className="font-sans text-small text-muted">
            {t("Держи собранную грань в жёлтой рамке и снимай — прочитано {done}/{total}.", {
              done: s.verifyFacesLength,
              total,
            })}
          </p>
          {nextFace ? (
            <p className="font-sans text-body font-extrabold text-ink">
              {t(facePromptFor(nextFace, true))}
            </p>
          ) : null}
          <Button onClick={s.solveVerifyStep}>{t("Снять грань")}</Button>
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
  const nextFace = nextFaceToShow(s.verifyCapturedFaces);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4.5">
      <h3 className="font-sans text-h3 text-ink">{t("Проверка сборки")}</h3>
      {s.collecting ? (
        <>
          <p className="font-sans text-small text-muted">
            {t("Держи грань в жёлтой рамке и снимай — прочитано {done}/{total}.", {
              done: s.verifyFacesLength,
              total,
            })}
          </p>
          {nextFace ? (
            <p className="font-sans text-body font-extrabold text-ink">
              {t(facePromptFor(nextFace, false))}
            </p>
          ) : null}
          <Button onClick={s.verifyStep}>{t("Снять грань")}</Button>
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
