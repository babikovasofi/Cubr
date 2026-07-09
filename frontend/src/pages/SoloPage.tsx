// Solo solve screen — Slice A: camera + hands + FSM + timer, on a real camera.
// No cube read / calibration / scramble / twisty yet (Slice B/C/D).
//
// ARCHITECTURE (see swarm-report/stage1-solo-plan.md "Архитектура"):
//  #1 StrictMode-safe via ASYNC-CANCELLATION, not a bare boolean flag. The mount
//     effect sets `let cancelled = false`; after every await it re-checks; cleanup
//     sets it true AND tears down whatever was acquired. If getUserMedia / hands
//     init resolves AFTER cleanup, we immediately stop/close it. Dev double-mount
//     leaves EXACTLY ONE camera stream + ONE landmarker.
//  #2 The hot loop (onFrame, run from rVFC) reads/writes REFS ONLY — never React
//     state or a prop closure. It is a single stable useCallback([]) reading
//     sessionRef.current. React state is published ONLY on an FSM transition
//     (the prototype's lastGuideKey gate, here as setPhase).
//  #3/#4 The timer is written straight to its DOM node per frame (no 60fps
//     setState). One clock: the rVFC `nowTs` (performance.now domain) feeds BOTH
//     the timer and fsm.step, so they never drift.
//  #5 fsm.ts is reused unchanged — we feed it Observation objects.
//  #6 Detection runs on the RAW frame; only the on-screen video+overlay are
//     CSS-mirrored (in CameraStage); drawOverlay flips Cyrillic locally.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Timer, { type Phase } from "../components/Timer";
import CameraStage from "../vision/components/CameraStage";
import { useCamera, CameraError, type FrameInfo } from "../vision/hooks/useCamera";
import { useHands, HandsInitError, defaultZones, drawOverlay } from "../vision/hooks/useHands";
import { HandsFsm, type FsmState } from "../vision/fsm";
import { config } from "../vision/config";
import { fmtSec } from "../vision/time";
import { cameraDeniedRu, modelFailedRu } from "../vision/guide";

// Per-frame mutable session state — the ref MIRROR the hot loop reads/writes.
// Never drives render directly; render state is published on transition.
interface Session {
  fsm: HandsFsm;
  solveStartTs: number | null;
  solveElapsedMs: number;
  lastGuideKey: string;
}

// Map the FSM state to the Timer's phase (dot + size).
function phaseFor(state: FsmState): Phase {
  switch (state) {
    case "SOLVING":
      return "running";
    case "STOPPED":
      return "success";
    default:
      return "ready";
  }
}

// Human RU phase label under the timer (Slice A: FSM phase, not the full guide).
const PHASE_RU: Record<FsmState, string> = {
  NO_HANDS: "Поставь обе руки в зелёные зоны и замри",
  HANDS_IN_ZONE: "Держи руки неподвижно — идёт готовность",
  READY: "Готово. Убери руки — таймер стартует",
  SOLVING: "Идёт сборка. Верни руки в зоны, чтобы остановить",
  STOPPED: "Время зафиксировано. Верни руки, чтобы начать заново",
};

export default function SoloPage() {
  const { videoRef, start: startCamera, stop: stopCamera } = useCamera();
  const { init: initHands, detect, setZones, close: closeHands } = useHands();

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const octxRef = useRef<CanvasRenderingContext2D | null>(null);
  const timerValueRef = useRef<HTMLSpanElement | null>(null);

  const sessionRef = useRef<Session>({
    fsm: new HandsFsm(),
    solveStartTs: null,
    solveElapsedMs: 0,
    lastGuideKey: "",
  });

  const zonesRef = useRef(defaultZones());

  // The single boolean that flips from onboarding -> live camera. Setting it true
  // is the permission-gesture trigger; the mount effect below does the acquire.
  const [armed, setArmed] = useState(false);
  const [live, setLive] = useState(false);
  const [fsmState, setFsmState] = useState<FsmState>("NO_HANDS");
  const [frozenValue, setFrozenValue] = useState("0.000");
  const [error, setError] = useState<{ ru: string } | null>(null);

  // Stable hot loop: reads/writes REFS ONLY. Empty deps -> identical across
  // renders, so no stale-closure trap. Publishes to React state only on change.
  const onFrame = useCallback(
    (info: FrameInfo) => {
      const { video, nowTs, width, height } = info;
      if (width === 0 || height === 0) return;

      const overlay = overlayRef.current;
      const octx = octxRef.current;
      if (!overlay || !octx) return;
      if (overlay.width !== width) overlay.width = width;
      if (overlay.height !== height) overlay.height = height;

      const s = sessionRef.current;
      const obs = detect(video, nowTs);
      const res = s.fsm.step({
        t: nowTs,
        handsDetected: obs.handsDetected,
        bothInZone: obs.bothInZone,
        still: obs.still,
        handsOutOfZone: obs.handsOutOfZone,
      });

      // Single-clock timer, driven by rVFC's performance.now()-domain timestamp.
      if (res.event === "solve_start") {
        s.solveStartTs = nowTs;
      } else if (res.event === "solve_stop" && s.solveStartTs !== null) {
        s.solveElapsedMs = nowTs - s.solveStartTs;
        s.solveStartTs = null;
        // Do NOT wedge at STOPPED: reset so the next cycle runs without reload.
        // The recorded time stays frozen on screen.
        s.fsm.reset();
        setFrozenValue(fmtSec(s.solveElapsedMs));
      } else if (res.event === "abort") {
        s.solveStartTs = null;
      }
      if (s.solveStartTs !== null) s.solveElapsedMs = nowTs - s.solveStartTs;

      // Per-frame timer write straight to the DOM node — NEVER setState here.
      const node = timerValueRef.current;
      if (node) node.textContent = fmtSec(s.solveElapsedMs);

      drawOverlay(octx, width, height, obs, zonesRef.current, config.GUIDE_RECT, {
        guide: "Держи кубик здесь",
        left: "Левая рука",
        right: "Правая рука",
      });

      // Publish to React ONLY on transition (lastGuideKey gate) — not 60×/s.
      const key = `${res.state}|${res.event ?? ""}`;
      if (key !== s.lastGuideKey) {
        s.lastGuideKey = key;
        setFsmState(res.state);
      }
    },
    [detect],
  );

  // Single mount effect: acquire hands + camera ONCE, release on unmount.
  // StrictMode-safe via async-cancellation (plan #1).
  useEffect(() => {
    if (!armed) return;

    let cancelled = false;
    setError(null);

    const octx = overlayRef.current?.getContext("2d") ?? null;
    octxRef.current = octx;

    (async () => {
      try {
        await initHands();
        if (cancelled) {
          // Resolved after cleanup -> release immediately.
          closeHands();
          return;
        }
        setZones(zonesRef.current);

        await startCamera(onFrame);
        if (cancelled) {
          // Stream came up after cleanup -> stop it immediately.
          stopCamera();
          closeHands();
          return;
        }
        setLive(true);
      } catch (e) {
        if (cancelled) {
          // Ensure nothing leaked if we errored during teardown.
          stopCamera();
          closeHands();
          return;
        }
        if (e instanceof HandsInitError) {
          setError({ ru: modelFailedRu() });
        } else if (e instanceof CameraError) {
          setError({ ru: cameraDeniedRu() });
        } else {
          setError({ ru: cameraDeniedRu() });
        }
        setArmed(false);
        setLive(false);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
      closeHands();
      setLive(false);
      // Reset the per-frame session so a re-mount starts clean.
      const s = sessionRef.current;
      s.fsm.reset();
      s.solveStartTs = null;
      s.solveElapsedMs = 0;
      s.lastGuideKey = "";
    };
  }, [armed, initHands, setZones, startCamera, stopCamera, closeHands, onFrame]);

  const retry = useCallback(() => {
    setError(null);
    setArmed(true);
  }, []);

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-2">
        <h2 className="font-sans text-h2 text-ink">Соло — сборка</h2>
        <p className="max-w-prose font-sans text-body text-muted">
          Тренировка на реальной камере: руки в зоны, убрал — таймер пошёл, вернул — стоп.
        </p>
      </section>

      {!armed && !error ? (
        <section className="flex max-w-prose flex-col gap-4 rounded-lg border border-line bg-surface p-4.5">
          <span className="font-sans text-overline uppercase text-muted">Что нужно</span>
          <ul className="flex flex-col gap-2 font-sans text-body text-ink">
            <li>Кубик 3×3 под рукой.</li>
            <li>Работающая веб-камера.</li>
            <li>Свет, чтобы руки было видно в кадре.</li>
          </ul>
          <div>
            <Button onClick={() => setArmed(true)}>Включить камеру</Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <section
          role="alert"
          className="flex max-w-prose flex-col gap-4 rounded-lg border border-danger bg-surface p-4.5"
        >
          <p className="font-sans text-body text-ink">{error.ru}</p>
          <div>
            <Button onClick={retry}>Попробовать снова</Button>
          </div>
        </section>
      ) : null}

      {armed ? (
        <section className="flex flex-col gap-4">
          <CameraStage
            videoRef={videoRef}
            overlayRef={overlayRef}
            workRef={workRef}
            live={live}
          />
          <div className="flex flex-col gap-1">
            <Timer value={frozenValue} phase={phaseFor(fsmState)} valueRef={timerValueRef} />
            <p aria-live="polite" className="font-sans text-body text-muted">
              {PHASE_RU[fsmState]}
            </p>
          </div>
        </section>
      ) : null}

      <Link
        to="/"
        className="font-sans text-body font-bold text-primary no-underline"
      >
        ← На главную
      </Link>
    </div>
  );
}
