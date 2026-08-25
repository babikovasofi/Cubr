// PROTOTYPE — демо «зелёная рамка удачного кадра». Изолирован от боевых
// экранов: свой роут /proto/green-frame (App.tsx, DEV-only, без пункта меню),
// своя папка src/proto/, ни один файл vision/*.ts не изменён.
//
// Что показывает: жёлто-зелёная рамка-гайд (goodFrame.ts + goodFrameOverlay.ts)
// поверх живого видео, статус-текст и сырые сигналы — чтобы можно было
// оценить, стоит ли переносить идею в боевой оверлей. Решение об интеграции —
// отдельный шаг, здесь его нет.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import CameraStage from "../solo/CameraStage";
import { useGoodFrameCamera } from "./useGoodFrameCamera";
import { frameColor, statusText } from "./goodFrameOverlay";
import type { FrameStatus } from "./goodFrame";

const STATUS_ORDER: FrameStatus[] = ["seeking", "aligning", "good"];
const STATUS_RU: Record<FrameStatus, string> = {
  seeking: "ищет",
  aligning: "выравнивается",
  good: "готово",
};

function StatusBadge({
  status,
  confidence,
  reason,
}: {
  status: FrameStatus;
  confidence: number;
  reason: Parameters<typeof statusText>[1];
}) {
  const color = frameColor(status, confidence, reason);
  return (
    <div
      className="flex items-center gap-3 rounded-lg border-2 p-4"
      style={{ borderColor: color }}
    >
      <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex flex-col">
        <span className="font-sans text-body font-black text-ink">{statusText(status, reason)}</span>
        <span className="font-sans text-small text-muted">
          {STATUS_RU[status]} · уверенность {Math.round(confidence * 100)}%
        </span>
      </div>
    </div>
  );
}

function ConfidenceBar({ confidence, status }: { confidence: number; status: FrameStatus }) {
  const color = frameColor(status, confidence, null);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-line bg-surface-2">
      <div
        className="h-full rounded-full transition-[width] duration-150 ease-out"
        style={{ width: `${Math.round(confidence * 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// Живой цикл для режима «без камеры»: держит слайдер как источник «ok» и
// подаёт его в ТОТ ЖЕ трекер, что и камера, — так дебаунс/гистерезис видно и
// без живого видео (палец на слайдере вместо пальца перед камерой).
function SimulatePanel({ pushManual }: { pushManual: (ok: boolean) => void }) {
  const [value, setValue] = useState(70);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const id = window.setInterval(() => {
      pushManual(valueRef.current >= 50);
    }, 100);
    return () => window.clearInterval(id);
  }, [pushManual]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-surface p-4">
      <label className="flex flex-col gap-1 font-sans text-small text-ink">
        <span className="flex items-center justify-between">
          <span className="font-bold">Имитация кадра (без камеры)</span>
          <span className="tabular-nums text-muted">{value}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="accent-primary"
        />
      </label>
      <p className="font-sans text-small text-muted">
        Ниже 50 — кадр «плохой» (рамка тянется к жёлтому/красному), 50 и выше — «хороший» (рамка
        держит цель и постепенно доходит до зелёного). Слайдер двигает то же состояние, что и
        камера, — переход всё равно плавный, а не мгновенный.
      </p>
    </div>
  );
}

export default function GreenFrameDemoPage() {
  const demo = useGoodFrameCamera();
  const [simulate, setSimulate] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="font-sans text-h2 text-ink">Зелёная рамка удачного кадра (прототип)</h1>
          <Link to="/" className="font-sans text-small font-bold text-primary no-underline">
            ← На главную
          </Link>
        </div>
        <p className="max-w-prose font-sans text-small text-muted">
          Изолированное демо, не связано с боевыми экранами. Рамка-гайд меняет цвет от жёлтого к
          зелёному, когда грань уверенно легла в кадр: не слишком темно/светло, видна решётка
          наклеек, палец не закрывает грань. Оценка держится несколько кадров подряд (дебаунс),
          прежде чем показать «готово», и гаснет постепенно, а не мгновенно, если кадр снова стал
          плохим.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <CameraStage
            videoRef={demo.videoRef}
            overlayRef={demo.overlayRef}
            workRef={demo.workRef}
            error={demo.cameraError}
            onRetry={demo.startCamera}
          />
          {!demo.cameraStarted ? (
            <Button onClick={demo.startCamera}>Включить камеру</Button>
          ) : (
            <Button variant="secondary" onClick={demo.stopCamera}>
              Выключить камеру
            </Button>
          )}

          <label className="flex items-center gap-2 font-sans text-small text-ink">
            <input
              type="checkbox"
              checked={simulate}
              onChange={(e) => {
                setSimulate(e.target.checked);
                demo.resetTracker();
              }}
              className="accent-primary"
            />
            Демо без камеры (ползунок вместо видео)
          </label>
          {simulate ? <SimulatePanel pushManual={demo.pushManual} /> : null}
        </div>

        <div className="flex flex-col gap-4">
          <StatusBadge
            status={demo.quality.status}
            confidence={demo.quality.confidence}
            reason={demo.quality.reason}
          />
          <ConfidenceBar confidence={demo.quality.confidence} status={demo.quality.status} />

          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map((s) => (
              <span
                key={s}
                className={[
                  "rounded-full border-2 px-3 py-1 font-sans text-small font-black",
                  s === demo.quality.status
                    ? "border-ink bg-ink text-bg"
                    : "border-line bg-surface text-faint",
                ].join(" ")}
              >
                {STATUS_RU[s]}
              </span>
            ))}
          </div>

          <Button variant="secondary" onClick={demo.resetTracker}>
            Сбросить оценку
          </Button>

          {demo.lastSignal ? (
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-3 font-mono text-small text-ink">
              <span>яркость: {demo.lastSignal.luma.toFixed(1)}</span>
              <span>щели (gap): {demo.lastSignal.gap.toFixed(2)}</span>
              <span>границы (edge): {demo.lastSignal.edge.toFixed(2)}</span>
              <span>кожа (max по ячейкам): {(demo.lastSignal.skinMax * 100).toFixed(0)}%</span>
            </div>
          ) : (
            <p className="font-sans text-small text-faint">
              Сырых сигналов пока нет — включи камеру или режим без камеры.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
