// Onboarding (plan §B): 3 steps — intro, camera check (reuses useCamera+useHands),
// and cube registration (CubeRegisterWizard → first cube becomes primary). Every
// step is skippable; finishing marks the local onboarded flag. The cube step is
// skippable too — the profile isn't consumed in solo yet, so it's not a play gate.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import CameraStage from "../solo/CameraStage";
import CubeRegisterWizard from "../cubes/CubeRegisterWizard";
import { useCameraCheck } from "../onboarding/useCameraCheck";
import { markOnboarded } from "../auth/onboarding";
import { useT } from "../i18n/t";

const STEPS = ["Знакомство", "Проверка камеры", "Регистрация кубика"] as const;

export default function OnboardingPage() {
  const t = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  function finish() {
    markOnboarded();
    navigate("/", { replace: true });
  }

  // Camera steps (1 «Проверка камеры», 2 «Регистрация») need a wide container so
  // the live preview isn't squeezed to a tiny column; the intro stays calm/narrow.
  const containerWidth = step >= 1 ? "max-w-5xl" : "max-w-2xl";

  return (
    <div className={`mx-auto flex w-full ${containerWidth} flex-col gap-6`}>
      <ol className="flex flex-wrap gap-2" aria-label={t("Шаги онбординга")}>
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={[
              "rounded-full border-2 px-3 py-1 font-sans text-caption uppercase",
              i === step
                ? "border-ink bg-ink text-bg"
                : i < step
                  ? "border-success text-success"
                  : "border-line text-muted",
            ].join(" ")}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? <IntroStep onNext={() => setStep(1)} /> : null}
      {step === 1 ? <CameraStep onNext={() => setStep(2)} onBack={() => setStep(0)} /> : null}
      {step === 2 ? <CubeStep onFinish={finish} onBack={() => setStep(1)} /> : null}

      <button
        type="button"
        onClick={finish}
        className="self-center font-sans text-small font-bold text-muted underline"
      >
        {t("Пропустить онбординг")}
      </button>
    </div>
  );
}

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-6">
      <h1 className="font-sans text-h2 text-ink">{title}</h1>
      {children}
    </section>
  );
}

function IntroStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Как это работает")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Cubr судит сборку по камере: она видит твои руки и грани кубика. Дальше проверим, что камера работает, и покажем, где будет регистрация кубика.",
        )}
      </p>
      <Button onClick={onNext}>{t("Начать")}</Button>
    </StepCard>
  );
}

function CameraStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  const cam = useCameraCheck();
  const ready = cam.started && cam.handsSeen;

  return (
    <StepCard title={t("Проверка камеры")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Разреши доступ к камере и покажи обе руки в кадре. Как только руки будут видны — можно продолжать.",
        )}
      </p>

      {/*
        CameraStage (and the <video> it owns) is mounted from the very first
        render — same fix as CubeRegisterWizard. useCameraCheck.start() needs
        cam.videoRef.current attached to the DOM *before* it calls
        camera.start(); gating the element behind `cam.started` was a
        chicken-and-egg dead end (start() always failed with "video element
        not mounted", and the retry could never succeed either).
      */}
      <CameraStage
        videoRef={cam.videoRef}
        overlayRef={cam.overlayRef}
        workRef={cam.workRef}
        error={cam.error}
        onRetry={cam.start}
      />

      {cam.starting ? (
        <p className="font-sans text-small font-bold text-muted" aria-live="polite">
          {t("Запускаю камеру…")}
        </p>
      ) : !cam.started ? (
        <Button onClick={cam.start}>{t("Включить камеру")}</Button>
      ) : (
        <p
          className={`font-sans text-small font-bold ${ready ? "text-success" : "text-muted"}`}
          aria-live="polite"
        >
          {ready ? t("Камера и руки распознаются — отлично!") : t("Ищу руки в кадре…")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-sans text-small font-bold text-muted"
        >
          {t("← Назад")}
        </button>
        <Button onClick={onNext} disabled={!ready}>
          {t("Далее")}
        </Button>
        {cam.started && !ready ? (
          <button
            type="button"
            onClick={onNext}
            className="font-sans text-small font-bold text-warning underline"
          >
            {t("Пропустить (камера не проверена)")}
          </button>
        ) : null}
      </div>
    </StepCard>
  );
}

function CubeStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Регистрация кубика")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Сними цвет-профиль своего кубика — это первый и основной кубик. Можно пропустить и добавить позже в профиле.",
        )}
      </p>
      <CubeRegisterWizard defaultPrimary onDone={onFinish} onCancel={onFinish} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-sans text-small font-bold text-muted"
        >
          {t("← Назад")}
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="font-sans text-small font-bold text-warning underline"
        >
          {t("Пропустить регистрацию")}
        </button>
      </div>
    </StepCard>
  );
}
