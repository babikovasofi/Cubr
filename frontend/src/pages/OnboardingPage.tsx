// Onboarding (plan §B, extended into a full first-run tutorial): 7 steps —
// intro, the solve ritual explained, an annotated camera/hands setup guide,
// the live camera check (reuses useCamera+useHands), cube registration
// (CubeRegisterWizard → first cube becomes primary), a cups/ranks primer, and
// the account name (`handle`, П10). Every step is skippable; finishing marks
// the local onboarded flag. The teaching steps (ritual, camera guide, cups)
// sit BEFORE the live camera check on purpose — learn the setup, then try it
// live — and the cube step stays skippable: the profile isn't consumed in
// solo yet, so it's not a play gate.
//
// The name step is deliberately LAST, not folded into an existing one: it is
// the one field in the whole product that makes a person's name visible to
// others (friends list, tournament/daily boards — see FriendsSection/
// TournamentStandings/DailyBoard), so it earns its own honest pitch rather than
// riding along with the camera check or cube registration, which are both about
// hardware, not publicity.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import CameraStage from "../solo/CameraStage";
import CubeRegisterWizard from "../cubes/CubeRegisterWizard";
import HandleField from "../profile/HandleField";
import RitualSteps from "../onboarding/RitualSteps";
import CameraGuide from "../onboarding/CameraGuide";
import CupsIntro from "../onboarding/CupsIntro";
import { useCameraCheck } from "../onboarding/useCameraCheck";
import { markOnboarded } from "../auth/onboarding";
import { markOnboardedOnServer } from "../api/auth";
import { useAuthStore } from "../store/authStore";
import { ApiError } from "../api/client";
import { useT } from "../i18n/t";

const STEPS = [
  "Знакомство",
  "Как проходит сборка",
  "Камера и руки",
  "Проверка камеры",
  "Регистрация кубика",
  "Кубки и ранги",
  "Твой ник",
] as const;

// Steps whose content wants a wide column: the live camera preview and the
// mock camera-setup illustration both get squeezed in a narrow form column;
// the ritual grid reads fine wide too. Intro, cups primer and the name field
// are calm single-column content, so they stay narrow.
const WIDE_STEPS = new Set([1, 2, 3, 4]);

export default function OnboardingPage() {
  const t = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  function finish() {
    // Локальный ключ остаётся как кэш для переноса; решение принимает сервер,
    // поэтому отмечаем и там. Отметка идемпотентна, ответ ждать незачем: если
    // запрос не дойдёт, человек увидит онбординг ещё раз — это переживаемо, а
    // застрявшая кнопка «Готово» нет.
    markOnboarded();
    void markOnboardedOnServer()
      .then((user) => useAuthStore.setState({ user }))
      .catch(() => {});
    navigate("/", { replace: true });
  }

  const containerWidth = WIDE_STEPS.has(step) ? "max-w-5xl" : "max-w-2xl";

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
            {i + 1}. {t(label)}
          </li>
        ))}
      </ol>

      {step === 0 ? <IntroStep onNext={() => setStep(1)} /> : null}
      {step === 1 ? <RitualStep onNext={() => setStep(2)} onBack={() => setStep(0)} /> : null}
      {step === 2 ? <CameraGuideStep onNext={() => setStep(3)} onBack={() => setStep(1)} /> : null}
      {step === 3 ? <CameraStep onNext={() => setStep(4)} onBack={() => setStep(2)} /> : null}
      {step === 4 ? <CubeStep onNext={() => setStep(5)} onBack={() => setStep(3)} /> : null}
      {step === 5 ? <CupsStep onNext={() => setStep(6)} onBack={() => setStep(4)} /> : null}
      {step === 6 ? <HandleStep onFinish={finish} onBack={() => setStep(5)} /> : null}

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
          "Cubr судит сборку по камере: она видит твои руки и грани кубика. Дальше проверим, что камера работает.",
        )}
      </p>
      <Button onClick={onNext}>{t("Начать")}</Button>
    </StepCard>
  );
}

function RitualStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Как проходит сборка")}>
      <RitualSteps />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-sans text-small font-bold text-muted"
        >
          {t("← Назад")}
        </button>
        <Button onClick={onNext}>{t("Далее")}</Button>
      </div>
    </StepCard>
  );
}

function CameraGuideStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Как поставить камеру и руки")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Прежде чем включать камеру — вот как выглядит правильный кадр. Дальше проверим твой настоящий.",
        )}
      </p>
      <CameraGuide />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-sans text-small font-bold text-muted"
        >
          {t("← Назад")}
        </button>
        <Button onClick={onNext}>{t("Далее")}</Button>
      </div>
    </StepCard>
  );
}

function CupsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Кубки и ранги")}>
      <p className="font-sans text-body text-muted">
        {t("За победу в дуэли начисляются кубки, за поражение часть уходит сопернику.")}
      </p>
      <CupsIntro />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-sans text-small font-bold text-muted"
        >
          {t("← Назад")}
        </button>
        <Button onClick={onNext}>{t("Далее")}</Button>
      </div>
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
          "Разреши доступ и повтори кадр с прошлого шага: обе кисти на столе — в зелёные зоны, кубик — в жёлтую рамку. Как только руки видно — можно продолжать.",
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
          {ready
            ? t("Обе руки в зонах — отлично!")
            : t("Положи обе кисти в зелёные зоны на столе…")}
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

function CubeStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <StepCard title={t("Регистрация кубика")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Сними цвет-профиль своего кубика — это первый и основной кубик. Можно пропустить и добавить позже в профиле.",
        )}
      </p>
      <CubeRegisterWizard defaultPrimary onDone={onNext} onCancel={onNext} />
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
          onClick={onNext}
          className="font-sans text-small font-bold text-warning underline"
        >
          {t("Пропустить регистрацию")}
        </button>
      </div>
    </StepCard>
  );
}

// Имя аккаунта (`handle`, П10) — единственное поле, которое видит кто-то
// кроме владельца. Один и тот же «Далее»/submit сохраняет имя, если оно
// набрано, и просто идёт дальше, если поле пустое — отдельной кнопки
// «Пропустить» с приглушённым текстом здесь нет: она была бы тёмным паттерном
// (реальный CTA виден, а отказ спрятан), а так пропуск — это буквально то же
// самое действие, что и продолжение. Ошибка (фильтр имён/занятый ник)
// держит человека на шаге, а не проглатывается.
function HandleStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const t = useT();
  const updateMe = useAuthStore((s) => s.updateMe);
  const currentHandle = useAuthStore((s) => s.user?.handle);
  // Ник, заданный при регистрации, подставляем сразу — человек просто жмёт
  // «Далее» или правит, а не вводит заново (owner).
  const [handle, setHandle] = useState(currentHandle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (trimmed === "") {
      onFinish();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateMe({ handle: trimmed });
      onFinish();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("Не удалось сохранить имя. Попробуй ещё раз."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title={t("Твой ник")}>
      <p className="font-sans text-body text-muted">
        {t(
          "Твой ник с регистрации уже здесь — проверь или поменяй. По нему тебя находят и добавляют в друзья, и он появляется в таблицах турнира и скрамбла дня. Изменить можно и позже в профиле.",
        )}
      </p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <HandleField value={handle} onChange={setHandle} error={error} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="font-sans text-small font-bold text-muted"
          >
            {t("← Назад")}
          </button>
          <Button type="submit" disabled={busy}>
            {busy ? t("Сохраняю…") : t("Далее")}
          </Button>
        </div>
      </form>
    </StepCard>
  );
}
