// DEV-ONLY tuning lab for the solo-timer start/stop logic (same spirit as
// /accuracy, but for WHEN the timer starts/stops relative to hands + cube).
// Gated behind import.meta.env.DEV at the route level (App.tsx) — never shipped.

import { useEffect, useState, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import CameraStage from "../solo/CameraStage";
import Button from "../components/Button";
import {
  useTimingLab,
  defaultLabConfig,
  type LabConfig,
  type LabZones,
  type LabReadout,
} from "./useTimingLab";
import { defaultZones } from "../vision/overlay";
import type { FsmState } from "../vision/fsm";

const DEFAULT_CFG = defaultLabConfig();
const DEFAULT_ZONES = defaultZones();

const STATE_ORDER: FsmState[] = ["NO_HANDS", "HANDS_IN_ZONE", "READY", "SOLVING", "STOPPED"];

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return `${ms.toFixed(0)} мс`;
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border-2 px-2.5 py-0.5 font-sans text-small font-bold",
        on ? "border-ink bg-primary text-white" : "border-line bg-surface-2 text-muted",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function StateReadout({ state }: { state: FsmState }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STATE_ORDER.map((s) => (
        <span
          key={s}
          className={[
            "rounded-full border-2 px-3 py-1 font-sans text-small font-black",
            s === state ? "border-ink bg-ink text-bg" : "border-line bg-surface text-faint",
          ].join(" ")}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue?: number;
  onChange: (v: number) => void;
}) {
  const changed = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="flex flex-col gap-1 font-sans text-small text-ink">
      <span className="flex items-center justify-between gap-2">
        <span className="font-bold">{label}</span>
        <span className="flex items-center gap-2">
          {changed ? (
            <button
              type="button"
              onClick={() => onChange(defaultValue as number)}
              title={`Сбросить к ${defaultValue}${unit}`}
              className="rounded-full border border-line px-1.5 py-0.5 text-caption font-bold text-primary hover:bg-surface-2"
            >
              ↺ {defaultValue}
              {unit}
            </button>
          ) : null}
          <span className="tabular-nums text-muted">
            {value}
            {unit}
          </span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary"
      />
    </label>
  );
}

function RectFields({
  label,
  rect,
  defaults,
  onChange,
}: {
  label: string;
  rect: LabZones["left"];
  defaults: LabZones["left"];
  onChange: (patch: Partial<LabZones["left"]>) => void;
}) {
  const AXES: { key: "x" | "y" | "w" | "h"; label: string }[] = [
    { key: "x", label: "x" },
    { key: "y", label: "y" },
    { key: "w", label: "ширина" },
    { key: "h", label: "высота" },
  ];
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <legend className="px-1 font-sans text-small font-bold text-ink">{label}</legend>
      {AXES.map(({ key, label: axisLabel }) => (
        <NumberField
          key={key}
          label={axisLabel}
          value={Math.round(rect[key] * 100) / 100}
          min={0}
          max={1}
          step={0.01}
          unit=""
          defaultValue={defaults[key]}
          onChange={(v) => onChange({ [key]: v } as Partial<LabZones["left"]>)}
        />
      ))}
    </fieldset>
  );
}

// Живая читалка: снимает readoutRef на своём интервале (~8 Гц) и рендерит
// ТОЛЬКО себя. Так цикл кадров не заставляет ре-рендериться колонку с
// ползунками — контролируемые слайдеры больше не откатываются при перетаскивании.
function LiveReadout({
  readoutRef,
  resetFsm,
}: {
  readoutRef: MutableRefObject<LabReadout>;
  resetFsm: () => void;
}) {
  const [snap, setSnap] = useState<LabReadout>(readoutRef.current);
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = readoutRef.current;
      // Новый объект каждый тик — иначе setState не заметит мутацию ref.
      setSnap({
        fsmState: r.fsmState,
        lastEvent: r.lastEvent,
        obs: r.obs,
        liveMs: r.liveMs,
        eventLog: r.eventLog,
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [readoutRef]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface p-4 lg:sticky lg:top-4">
      <StateReadout state={snap.fsmState} />

      <div className="flex flex-wrap gap-2">
        <Chip on={snap.obs.handsDetected} label="руки видны" />
        <Chip on={snap.obs.bothInZone} label="обе в зоне" />
        <Chip on={snap.obs.still} label="неподвижны" />
        <Chip on={snap.obs.handsOutOfZone > 0} label={`вне зоны: ${snap.obs.handsOutOfZone}`} />
      </div>

      <div className="flex items-baseline justify-between">
        <span className="font-sans text-small font-bold text-muted">Таймер</span>
        <span className="font-mono text-h2 tabular-nums text-ink">{formatMs(snap.liveMs)}</span>
      </div>
      {snap.lastEvent ? (
        <p className="font-sans text-small text-muted">
          Последнее событие: <span className="font-bold text-ink">{snap.lastEvent}</span>
        </p>
      ) : null}

      <Button variant="secondary" onClick={resetFsm}>
        Сбросить FSM
      </Button>

      <div className="flex flex-col gap-1">
        <span className="font-sans text-overline uppercase text-muted">
          Журнал событий ({snap.eventLog.length})
        </span>
        <div className="max-h-48 overflow-y-auto rounded-md border border-line">
          {snap.eventLog.length === 0 ? (
            <p className="p-2 font-sans text-small text-faint">Событий пока не было.</p>
          ) : (
            <table className="w-full font-mono text-small">
              <tbody>
                {[...snap.eventLog]
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <tr key={`${e.t}-${i}`} className="border-t border-line first:border-t-0">
                      <td className="px-2 py-1 text-ink">{e.event}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted">
                        {formatMs(e.elapsedMs)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TimingLabPage() {
  const lab = useTimingLab();

  const patchConfig = (patch: Partial<LabConfig>): void => lab.setLabConfig(patch);

  const configText = JSON.stringify(lab.labConfig, null, 2);
  const zonesText = JSON.stringify(lab.zones, null, 2);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="font-sans text-h2 text-ink">Настройка старта/стопа таймера (dev)</h1>
          <Link to="/" className="font-sans text-small font-bold text-primary no-underline">
            ← На главную
          </Link>
        </div>
        <p className="max-w-prose font-sans text-small text-muted">
          Dev-инструмент. Смотрим сырые сигналы рук и состояние FSM в реальном времени, крутим
          пороги, пока старт и стоп таймера не начнут совпадать с тем, что реально происходит.
          Ничего не сохраняется — подобранные числа переносятся вручную в vision/config.ts.
        </p>
      </header>

      {/* Камера крупная — как на сайте: своим блоком во всю ширину сверху. */}
      <div className="mx-auto w-full max-w-3xl">
        <CameraStage
          videoRef={lab.videoRef}
          overlayRef={lab.overlayRef}
          workRef={lab.workRef}
          error={lab.cameraError}
          onRetry={lab.startCamera}
        />
        {!lab.cameraStarted ? (
          <Button className="mt-3" onClick={lab.startCamera}>
            Включить камеру
          </Button>
        ) : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Живой статус слева, пороги справа. Читалка — отдельный компонент со
            своим тиком по ref, чтобы кадры не ре-рендерили колонку с порогами. */}
        <LiveReadout readoutRef={lab.readoutRef} resetFsm={lab.resetFsm} />

        {/* Пороги — трогают редко, второй колонкой. */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-sans text-body font-black text-ink">Пороги FSM</h2>
              <Button variant="secondary" onClick={lab.resetDefaults}>
                Сбросить к дефолтам
              </Button>
            </div>

            <NumberField
              label="STOP_MS — сколько держать «обе руки в зоне», чтобы остановить"
              value={lab.labConfig.STOP_MS}
              min={0}
              max={2000}
              step={10}
              unit=" мс"
              defaultValue={DEFAULT_CFG.STOP_MS}
              onChange={(v) => patchConfig({ STOP_MS: v })}
            />
            <NumberField
              label="ZONE_ENTER_MS — сколько держать «обе в зоне», чтобы войти в HANDS_IN_ZONE"
              value={lab.labConfig.ZONE_ENTER_MS}
              min={0}
              max={2000}
              step={10}
              unit=" мс"
              defaultValue={DEFAULT_CFG.ZONE_ENTER_MS}
              onChange={(v) => patchConfig({ ZONE_ENTER_MS: v })}
            />
            <NumberField
              label="STILL_MS — сколько держать неподвижность, чтобы стать READY"
              value={lab.labConfig.STILL_MS}
              min={0}
              max={3000}
              step={10}
              unit=" мс"
              defaultValue={DEFAULT_CFG.STILL_MS}
              onChange={(v) => patchConfig({ STILL_MS: v })}
            />
            <NumberField
              label="LEAVE_DEBOUNCE_MS — сколько держать «рука вне зоны», чтобы засчитать уход"
              value={lab.labConfig.LEAVE_DEBOUNCE_MS}
              min={0}
              max={1000}
              step={10}
              unit=" мс"
              defaultValue={DEFAULT_CFG.LEAVE_DEBOUNCE_MS}
              onChange={(v) => patchConfig({ LEAVE_DEBOUNCE_MS: v })}
            />
            <NumberField
              label="ABORT_MS — сколько держать «руки не видны», чтобы сбросить попытку"
              value={lab.labConfig.ABORT_MS}
              min={0}
              max={3000}
              step={10}
              unit=" мс"
              defaultValue={DEFAULT_CFG.ABORT_MS}
              onChange={(v) => patchConfig({ ABORT_MS: v })}
            />
            <NumberField
              label="STILL_MOTION_FRAC — порог движения (доля размера ладони)"
              value={lab.labConfig.STILL_MOTION_FRAC}
              min={0}
              max={0.2}
              step={0.005}
              unit=""
              defaultValue={DEFAULT_CFG.STILL_MOTION_FRAC}
              onChange={(v) => patchConfig({ STILL_MOTION_FRAC: v })}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="flex w-full items-center justify-between gap-2 font-sans text-small font-bold text-ink">
                <span>START_RULE — какая рука стартует таймер</span>
                {lab.labConfig.START_RULE !== DEFAULT_CFG.START_RULE ? (
                  <button
                    type="button"
                    onClick={() => patchConfig({ START_RULE: DEFAULT_CFG.START_RULE })}
                    className="rounded-full border border-line px-1.5 py-0.5 text-caption font-bold text-primary hover:bg-surface-2"
                  >
                    ↺ {DEFAULT_CFG.START_RULE === "first" ? "первая рука" : "обе руки"}
                  </button>
                ) : null}
              </legend>
              <div className="inline-flex w-fit overflow-hidden rounded-full border-2 border-ink">
                {(["first", "both"] as const).map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    onClick={() => patchConfig({ START_RULE: rule })}
                    className={[
                      "px-4 py-1.5 font-sans text-small font-extrabold",
                      lab.labConfig.START_RULE === rule
                        ? "bg-primary text-white"
                        : "bg-surface text-ink hover:bg-surface-2",
                    ].join(" ")}
                    aria-pressed={lab.labConfig.START_RULE === rule}
                  >
                    {rule === "first" ? "первая рука" : "обе руки"}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-surface p-4">
            <h2 className="font-sans text-body font-black text-ink">Зоны рук</h2>
            <p className="font-sans text-small text-muted">
              Доли кадра (0–1). Дефолт — узкая полоса внизу кадра, которая ловит обычную позу
              решения — отсюда и ранний стоп.
            </p>
            <RectFields
              label="Левая зона (сырой кадр)"
              rect={lab.zones.left}
              defaults={DEFAULT_ZONES.left}
              onChange={(patch) => lab.setZones({ left: { ...lab.zones.left, ...patch } })}
            />
            <RectFields
              label="Правая зона (сырой кадр)"
              rect={lab.zones.right}
              defaults={DEFAULT_ZONES.right}
              onChange={(patch) => lab.setZones({ right: { ...lab.zones.right, ...patch } })}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-surface-2 p-4">
            <h2 className="font-sans text-body font-black text-ink">
              Текущие значения (для переноса в config.ts)
            </h2>
            <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-small text-ink">
              {configText}
            </pre>
            <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-small text-ink">
              {zonesText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
