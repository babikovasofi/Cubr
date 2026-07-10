// Onboarding (plan §B): 3 steps — intro, camera check (reuses useCamera+useHands),
// and a labelled cube-registration placeholder (real flow lands in Stage 2.4).
// Every step is skippable with a warning; finishing marks the local onboarded flag.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import CameraStage from "../solo/CameraStage";
import Spinner from "../components/Spinner";
import { useCameraCheck } from "../onboarding/useCameraCheck";
import { markOnboarded } from "../auth/onboarding";

const STEPS = ["Знакомство", "Проверка камеры", "Регистрация кубика"] as const;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  function finish() {
    markOnboarded();
    navigate("/", { replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ol className="flex flex-wrap gap-2" aria-label="Шаги онбординга">
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
      {step === 1 ? (
        <CameraStep onNext={() => setStep(2)} onBack={() => setStep(0)} />
      ) : null}
      {step === 2 ? <CubeStep onFinish={finish} onBack={() => setStep(1)} /> : null}

      <button
        type="button"
        onClick={finish}
        className="self-center font-sans text-small font-bold text-muted underline"
      >
        Пропустить онбординг
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
  return (
    <StepCard title="Как это работает">
      <p className="font-sans text-body text-muted">
        Cubr судит сборку по камере: она видит твои руки и грани кубика. Дальше проверим,
        что камера работает, и покажем, где будет регистрация кубика.
      </p>
      <Button onClick={onNext}>Начать</Button>
    </StepCard>
  );
}

function CameraStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const cam = useCameraCheck();
  const ready = cam.started && cam.handsSeen;

  return (
    <StepCard title="Проверка камеры">
      <p className="font-sans text-body text-muted">
        Разреши доступ к камере и покажи обе руки в кадре. Как только руки будут видны —
        можно продолжать.
      </p>

      {cam.started ? (
        <>
          <CameraStage
            videoRef={cam.videoRef}
            overlayRef={cam.overlayRef}
            workRef={cam.workRef}
            error={cam.error}
            onRetry={cam.start}
          />
          <p
            className={`font-sans text-small font-bold ${ready ? "text-success" : "text-muted"}`}
            aria-live="polite"
          >
            {ready ? "Камера и руки распознаются — отлично!" : "Ищу руки в кадре…"}
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {cam.error ? (
            <p role="alert" className="font-sans text-small text-danger">
              {cam.error}
            </p>
          ) : null}
          <Button onClick={cam.start}>Включить камеру</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="font-sans text-small font-bold text-muted">
          ← Назад
        </button>
        <Button onClick={onNext} disabled={!ready}>
          Далее
        </Button>
        {cam.started && !ready ? (
          <button
            type="button"
            onClick={onNext}
            className="font-sans text-small font-bold text-warning underline"
          >
            Пропустить (камера не проверена)
          </button>
        ) : null}
      </div>
    </StepCard>
  );
}

function CubeStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  return (
    <StepCard title="Регистрация кубика">
      <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-line bg-surface-2 p-8 text-center">
        <Spinner label="" />
        <p className="font-sans text-body font-bold text-ink">Регистрация кубика — Этап 2.4</p>
        <p className="font-sans text-small text-muted">
          Здесь ты снимешь цвет-профиль своего кубика. Пока этот шаг — заглушка, можно
          продолжить без него.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="font-sans text-small font-bold text-muted">
          ← Назад
        </button>
        <Button onClick={onFinish}>Завершить</Button>
      </div>
    </StepCard>
  );
}
