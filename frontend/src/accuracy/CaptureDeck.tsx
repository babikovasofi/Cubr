// Всё, что тестировщик нажимает С КУБИКОМ В РУКАХ: калибровка, съёмка граней,
// подсказка шага и ошибка последнего чтения.
//
// Живёт отдельным компонентом ради одного: на странице он стоит ПОД камерой, а
// не в правой колонке вместе с настройками и таблицами. Разница не косметическая
// — снимая грань, человек смотрит в кадр и должен видеть подсказку и текст
// отказа тем же взглядом. Когда кнопка «снять» и объяснение «почему не вышло»
// разъезжаются на два экрана, двадцать чтений подряд снять невозможно; на живом
// прогоне 2026-08-03 это и остановило замер.
//
// Настройки (режим, хватка, теги) остаются в AccuracyControls: их трогают один
// раз в начале условия, а не на каждой грани.

import Button from "../components/Button";
import { CAPTURE_ORDER } from "../vision/accuracyRun";
import { lab2rgb } from "../vision/colors";
import { CAPTURE_HINTS } from "./captureHints";
import type { AccuracySession } from "./useAccuracySession";

// При свободной хватке ориентация не задана — просить «наверху центр белый»
// значит требовать того, что режим только что разрешил не соблюдать.
export function hintFor(step: number, grip: string): string {
  const hint = CAPTURE_HINTS[Math.min(step, 5)];
  if (grip !== "free") return hint.ru;
  return `${hint.ru.split(".")[0]}. Держи как удобно — ориентация не важна.`;
}

interface CaptureDeckProps {
  session: AccuracySession;
}

export default function CaptureDeck({ session }: CaptureDeckProps) {
  const captureStep = session.collectingAccuracy ? session.accFacesLength : 0;
  const hint = hintFor(captureStep, session.grip);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4">
      {!session.calibrated ? (
        <div className="flex flex-col gap-2">
          <span className="font-sans text-overline uppercase text-muted">
            Шаг 1 — калибровка ({Math.min(session.calibrationStep, 6)}/6)
          </span>
          <p className="font-sans text-small text-muted">
            Собранный кубик, 6 граней в порядке {CAPTURE_ORDER.join(" ")}.
          </p>
          <Button onClick={session.captureCalibration} disabled={!session.cameraStarted}>
            Снять грань калибровки {Math.min(session.calibrationStep + 1, 6)}/6
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-sans text-overline uppercase text-muted">
              {session.collectingAccuracy ? `Грань ${captureStep + 1} из 6` : "Готов к чтению"}
            </span>
            <button
              type="button"
              onClick={session.recalibrate}
              className="font-sans text-caption font-bold text-muted underline"
            >
              перекалиброваться
            </button>
          </div>
          {session.collectingAccuracy ? (
            <p className="font-sans text-body font-bold text-ink">{hint}</p>
          ) : (
            <p className="font-sans text-small text-muted">
              Собери скрамбл на кубике, потом жми «Начать чтение».
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={session.captureFace}
              disabled={!session.cameraStarted || !session.calibrated}
            >
              {session.collectingAccuracy ? `Снять грань ${captureStep + 1}/6` : "Начать чтение"}
            </Button>
            {session.collectingAccuracy ? (
              <Button onClick={session.cancelCapture} className="bg-surface-2 text-ink">
                Отменить
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {session.captureError ? (
        <p role="alert" className="font-sans text-small font-bold text-danger">
          {session.captureError}
        </p>
      ) : null}

      {/* Снятые эталоны: если это не шесть РАЗНЫХ цветов кубика, калибровка
          провалилась, и любое чтение поверх неё бессмысленно. Держим здесь же —
          проверять их надо ровно в момент калибровки, глядя в кадр. */}
      {session.calibratedRefs ? (
        <div className="flex items-center gap-2">
          <span className="font-sans text-caption uppercase text-muted">Эталоны</span>
          <div className="flex gap-1">
            {CAPTURE_ORDER.map((face) => {
              const lab = session.calibratedRefs?.[face];
              const [r, g, b] = lab ? lab2rgb(lab) : [0, 0, 0];
              return (
                <span
                  key={face}
                  className="h-6 w-6 rounded border-2 border-ink"
                  style={{ backgroundColor: `rgb(${r} ${g} ${b})` }}
                  title={`${face}: rgb(${r} ${g} ${b})`}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
