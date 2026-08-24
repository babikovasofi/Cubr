// DEV-ONLY tuning lab for the solo-timer start/stop logic. Mirrors the
// camera/hands per-frame loop from solo/useSoloSession.ts (StrictMode-safe
// imperative start, single onFrame closure over refs), but drives a
// LAB-OWNED HandsFsm built from a live-tunable config held in a ref, so every
// slider edit takes effect immediately without restarting the camera or the
// solve cycle.
//
// The owner's real bug: while she was still solving, the timer stopped too
// early (default STOP_MS=200 — only 200ms of "both hands back in zone" ends
// the solve; the bottom-of-frame zones catch a normal solving posture). This
// page exists to WATCH the raw signals (bothInZone/still/handsOutOfZone) and
// the FSM state live, and tune thresholds + zone rects until start/stop feel
// right, before baking the numbers back into vision/config.ts.

import { useEffect, useRef, useState } from "react";
import { HandsFsm, type FsmState, type FsmEvent } from "../vision/fsm";
import { config as defaultConfig, type Config, type Rect } from "../vision/config";
import { drawOverlay, defaultZones } from "../vision/overlay";
import { useCamera, CameraError, type FrameInfo } from "../vision/hooks/useCamera";
import { cameraErrorRu } from "../vision/cameraErrors";
import { useHands, HandsInitError } from "../vision/hooks/useHands";
import { modelFailedRu, cameraDeniedRu } from "../vision/guide";

// The subset of Config the lab exposes sliders for — everything the FSM +
// stillness metric actually reads. Kept as a named type so the controls panel
// and this hook agree on exactly what's tunable.
export type LabConfig = Pick<
  Config,
  | "ZONE_ENTER_MS"
  | "STILL_MS"
  | "STOP_MS"
  | "LEAVE_DEBOUNCE_MS"
  | "ABORT_MS"
  | "STILL_MOTION_FRAC"
  | "START_RULE"
>;

export interface LabZones {
  left: Rect;
  right: Rect;
}

export interface LabEventLogEntry {
  event: Exclude<FsmEvent, null>;
  t: number; // frame timestamp (performance.now domain) the event fired at
  elapsedMs: number; // ms since the run's solve_start (0 for solve_start itself, NaN before any start)
}

export interface LabObs {
  handsDetected: boolean;
  bothInZone: boolean;
  still: boolean;
  handsOutOfZone: number;
  hands: { inZone: boolean }[];
}

function defaultLabConfig(): LabConfig {
  return {
    ZONE_ENTER_MS: defaultConfig.ZONE_ENTER_MS,
    STILL_MS: defaultConfig.STILL_MS,
    STOP_MS: defaultConfig.STOP_MS,
    LEAVE_DEBOUNCE_MS: defaultConfig.LEAVE_DEBOUNCE_MS,
    ABORT_MS: defaultConfig.ABORT_MS,
    STILL_MOTION_FRAC: defaultConfig.STILL_MOTION_FRAC,
    START_RULE: defaultConfig.START_RULE,
  };
}

export interface TimingLab {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;

  // Live readout, updated once per processed frame.
  fsmState: FsmState;
  lastEvent: FsmEvent;
  obs: LabObs;
  liveMs: number; // ms since solve_start, 0 while not solving
  eventLog: LabEventLogEntry[];
  resetFsm: () => void;

  // Live-tunable config + zones. Editing these takes effect on the NEXT
  // frame — no camera restart, no FSM reset.
  labConfig: LabConfig;
  setLabConfig: (patch: Partial<LabConfig>) => void;
  zones: LabZones;
  setZones: (patch: Partial<LabZones>) => void;
  resetDefaults: () => void;
}

const NO_OBS: LabObs = {
  handsDetected: false,
  bothInZone: false,
  still: false,
  handsOutOfZone: 0,
  hands: [],
};

export function useTimingLab(): TimingLab {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const camera = useCamera(videoRef, () => setCameraStarted(false));
  const hands = useHands();

  const [labConfig, setLabConfigState] = useState<LabConfig>(defaultLabConfig());
  const [zones, setZonesState] = useState<LabZones>(defaultZones());

  // Live refs the frame loop reads — so a slider change is visible on the
  // very next frame without re-registering onFrame or touching the FSM.
  const cfgRef = useRef<Config>({ ...defaultConfig, ...labConfig });
  const zonesRef = useRef<LabZones>(zones);

  // The FSM holds a REFERENCE to cfgRef.current; slider edits mutate that
  // same object in place (see setLabConfig), so the FSM picks them up
  // mid-run without being rebuilt or reset.
  const fsmRef = useRef<HandsFsm | null>(null);
  const getFsm = (): HandsFsm => (fsmRef.current ??= new HandsFsm(cfgRef.current));

  const [fsmState, setFsmState] = useState<FsmState>("NO_HANDS");
  const [lastEvent, setLastEvent] = useState<FsmEvent>(null);
  const [obs, setObs] = useState<LabObs>(NO_OBS);
  const [liveMs, setLiveMs] = useState(0);
  const [eventLog, setEventLog] = useState<LabEventLogEntry[]>([]);
  const startTRef = useRef<number | null>(null);

  const setLabConfig = (patch: Partial<LabConfig>): void => {
    setLabConfigState((c) => {
      const next = { ...c, ...patch };
      // Mutate the SAME object the FSM references, in place — no rebuild.
      Object.assign(cfgRef.current, next);
      return next;
    });
  };

  const setZones = (patch: Partial<LabZones>): void => {
    setZonesState((z) => {
      const next = { ...z, ...patch };
      zonesRef.current = next;
      hands.setZones(next);
      return next;
    });
  };

  const resetFsm = (): void => {
    getFsm().reset();
    startTRef.current = null;
    setFsmState("NO_HANDS");
    setLastEvent(null);
    setLiveMs(0);
  };

  const resetDefaults = (): void => {
    const dc = defaultLabConfig();
    const dz = defaultZones();
    Object.assign(cfgRef.current, dc);
    setLabConfigState(dc);
    zonesRef.current = dz;
    setZonesState(dz);
    hands.setZones(dz);
    hands.setStillMotionFrac(dc.STILL_MOTION_FRAC);
    resetFsm();
  };

  const onFrame = (info: FrameInfo): void => {
    const { video, nowTs, width, height } = info;
    if (!width || !height) return;

    const o = hands.detect(video, nowTs);

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      const ctx = overlay.getContext("2d");
      if (ctx) drawOverlay(ctx, width, height, o, zonesRef.current, cfgRef.current.GUIDE_RECT);
    }

    setObs({
      handsDetected: o.handsDetected,
      bothInZone: o.bothInZone,
      still: o.still,
      handsOutOfZone: o.handsOutOfZone,
      hands: o.hands.map((h) => ({ inZone: h.inZone })),
    });

    const res = getFsm().step({
      t: nowTs,
      handsDetected: o.handsDetected,
      bothInZone: o.bothInZone,
      still: o.still,
      handsOutOfZone: o.handsOutOfZone,
    });
    setFsmState(res.state);

    if (res.event === "solve_start") startTRef.current = nowTs;
    if (res.event) {
      setLastEvent(res.event);
      const startT = res.event === "solve_start" ? nowTs : startTRef.current;
      setEventLog((log) => [
        ...log,
        {
          event: res.event as Exclude<FsmEvent, null>,
          t: nowTs,
          elapsedMs: startT === null ? NaN : nowTs - startT,
        },
      ]);
      if (res.event === "abort") startTRef.current = null;
    }

    if (res.state === "SOLVING" && startTRef.current !== null) {
      setLiveMs(nowTs - startTRef.current);
    }
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted && camera.isLive()) return;
    try {
      setCameraError(null);
      await hands.init();
      hands.setZones(zonesRef.current);
      hands.setStillMotionFrac(cfgRef.current.STILL_MOTION_FRAC);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      if (camera.isLive()) {
        setCameraStarted(true);
        setCameraError(null);
        return;
      }
      if (e instanceof HandsInitError) setCameraError(modelFailedRu());
      else if (e instanceof CameraError) setCameraError(cameraErrorRu(e.kind));
      else setCameraError(cameraDeniedRu());
    }
  };

  useEffect(() => {
    return () => {
      camera.stop();
      hands.close();
    };
    // Run once: camera/hands proxy to stable refs.
  }, []);

  return {
    videoRef,
    overlayRef,
    workRef,
    cameraStarted,
    cameraError,
    startCamera,
    fsmState,
    lastEvent,
    obs,
    liveMs,
    eventLog,
    resetFsm,
    labConfig,
    setLabConfig,
    zones,
    setZones,
    resetDefaults,
  };
}
