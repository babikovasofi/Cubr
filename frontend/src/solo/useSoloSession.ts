// Solo-ritual orchestrator. Owns the per-frame loop (camera onFrame → hands.detect
// → HandsFsm.step → phase reducer + timer), the 6-face verify collection, and the
// camera lifecycle. Ported from prototype/main.ts, adapted to React 19 hooks.
//
// StrictMode: the camera/hands are started imperatively on a user action (not in an
// effect), and a single unmount-cleanup effect stops the stream + closes the
// landmarker. stop()/close() are idempotent, so the StrictMode early-cleanup is safe.
//
// Timebase (plan #4/#6): the timer reads o.t (the frame timestamp) — startT/stopT
// live in the reducer; the live display derives from the current frame's nowTs. No
// performance.now() in a React handler.

import { useEffect, useReducer, useRef, useState } from "react";
import { HandsFsm } from "../vision/fsm";
import { config } from "../vision/config";
import { drawOverlay, defaultZones, type OverlayLabels } from "../vision/overlay";
import { useCamera, CameraError, type FrameInfo, type CameraErrorKind } from "../vision/hooks/useCamera";
import { useHands, HandsInitError } from "../vision/hooks/useHands";
import { useCubeReader } from "../vision/hooks/useCubeReader";
import { useScramble } from "../scramble/hooks/useScramble";
import {
  cameraDeniedRu,
  modelFailedRu,
  faceUnreadableRu,
  rotationFailedRu,
  rotationAmbiguousRu,
} from "../vision/guide";
import {
  soloReducer,
  initialSoloState,
  type SoloState,
} from "./soloPhase";
import { buildSolvePayload, saveSoloResult, type SaveState } from "./solveSave";
import { isAuthed } from "../store/authStore";
import { getSelectedCubeId } from "../store/cubesStore";
import { createSolve } from "../api/solves";

const ZONES = defaultZones();
const OVERLAY_LABELS: OverlayLabels = {
  guide: "Держи кубик здесь",
  left: "Левая рука",
  right: "Правая рука",
};

function cameraErrorRu(kind: CameraErrorKind): string {
  switch (kind) {
    case "not-found":
      return "Камера не найдена. Подключи камеру и попробуй снова.";
    case "in-use":
      return "Камера занята другим приложением. Закрой его и попробуй снова.";
    case "insecure":
      return "Камера работает только по https (или на localhost). Открой страницу по защищённому адресу.";
    case "unsupported":
      return "Этот браузер не умеет работать с камерой. Открой в свежем Chrome или Firefox.";
    case "denied":
    default:
      return cameraDeniedRu();
  }
}

export interface SoloSession {
  state: SoloState;
  // Refs for CameraStage to bind.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  // Scramble.
  scramble: string;
  moves: string[];
  scrambleLoading: boolean;
  scrambleError: string | null;
  canVerify: boolean; // expected facelets available for the bridge
  regenerateScramble: () => void;
  // Camera.
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;
  // Calibration + verify.
  calibrationStep: number;
  calibrated: boolean;
  collecting: boolean;
  verifyFacesLength: number;
  verifyError: string | null;
  captureCalibration: () => void;
  recalibrate: () => void;
  verifyStep: () => void;
  // Navigation.
  gotoVerify: () => Promise<void>;
  backToWalkthrough: () => void;
  again: () => void;
  // Timer.
  timerSeconds: string;
  // Server persistence of the finished result (plan §B #8).
  saveState: SaveState;
}

export function useSoloSession(): SoloSession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  // Track death (device grabbed/unplugged/asleep) → reset so the UI can restart
  // without a page reload.
  const [cameraStarted, setCameraStarted] = useState(false);
  const camera = useCamera(videoRef, () => setCameraStarted(false));
  const hands = useHands();
  const reader = useCubeReader(workRef);
  const scramble = useScramble();

  const fsmRef = useRef<HandsFsm | null>(null);
  const getFsm = (): HandsFsm => (fsmRef.current ??= new HandsFsm());

  const [state, dispatch] = useReducer(soloReducer, initialSoloState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedRef = useRef(false);

  // Leave the loading gate once the scramble is generated.
  useEffect(() => {
    if (!scramble.loading && !scramble.error && stateRef.current.phase === "loading") {
      dispatch({ type: "scramble_ready" });
    }
  }, [scramble.loading, scramble.error]);

  // On entering "result", persist the solve exactly once (plan §B #8). Anonymous =
  // no-op (solo still works). This is an external-sync effect (a one-shot network
  // call keyed off the phase), guarded against StrictMode double-run and re-renders.
  useEffect(() => {
    if (state.phase !== "result") {
      savedRef.current = false;
      return;
    }
    if (savedRef.current) return;
    savedRef.current = true;

    if (!isAuthed()) {
      setSaveState("anon");
      return;
    }
    setSaveState("saving");
    const payload = buildSolvePayload(
      scramble.scramble,
      state.elapsedMs,
      state.dnf,
      getSelectedCubeId(),
    );
    void saveSoloResult({ isAuthed: true, payload, create: createSolve }).then(setSaveState);
  }, [state.phase, state.elapsedMs, state.dnf, scramble.scramble]);

  // Per-frame loop. Captured once at startCamera time; reads live refs, so it needs
  // no re-registration on re-render.
  const onFrame = (info: FrameInfo): void => {
    const { video, nowTs, width, height } = info;
    if (!width || !height) return;

    const obs = hands.detect(video, nowTs);

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      const octx = overlay.getContext("2d");
      if (octx) drawOverlay(octx, width, height, obs, ZONES, config.GUIDE_RECT, OVERLAY_LABELS);
    }

    const st = stateRef.current;
    if (st.phase !== "armed" && st.phase !== "solving") return;

    const res = getFsm().step({
      t: nowTs,
      handsDetected: obs.handsDetected,
      bothInZone: obs.bothInZone,
      still: obs.still,
      handsOutOfZone: obs.handsOutOfZone,
    });
    if (res.event === "solve_start") dispatch({ type: "solve_start", t: nowTs });
    else if (res.event === "solve_stop") dispatch({ type: "solve_stop", t: nowTs });
    else if (res.event === "abort") {
      dispatch({ type: "abort" });
      getFsm().reset();
    }
    if (st.phase === "solving" && st.startT !== null) setLiveMs(nowTs - st.startT);
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted && camera.isLive()) return;
    try {
      setCameraError(null);
      await hands.init();
      hands.setZones(ZONES);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      if (e instanceof HandsInitError) setCameraError(modelFailedRu());
      else if (e instanceof CameraError) setCameraError(cameraErrorRu(e.kind));
      else setCameraError(cameraDeniedRu());
    }
  };

  // Unmount cleanup: stop the stream + close the landmarker (StrictMode-safe).
  useEffect(() => {
    return () => {
      camera.stop();
      hands.close();
    };
    // Run once: camera/hands proxy to stable refs, so an empty dep list is correct
    // and avoids tearing down the stream on every render.
  }, []);

  const captureCalibration = (): void => {
    const v = videoRef.current;
    if (v) reader.captureCalibration(v);
  };

  const recalibrate = (): void => {
    setVerifyError(null);
    reader.recalibrate();
  };

  const verifyStep = (): void => {
    setVerifyError(null);
    if (!reader.calibrated) return;
    const expected = scramble.expectedFacelets;
    if (!expected) {
      setVerifyError("Не удалось подготовить эталон скрамбла. Обнови скрамбл.");
      return;
    }
    if (!reader.collecting) {
      reader.beginVerify();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const r = reader.pushVerifyFace(v, expected);
    switch (r.kind) {
      case "pending":
        return;
      case "ok":
        getFsm().reset();
        dispatch({ type: "verify_ok" });
        return;
      case "mismatch":
        dispatch({ type: "verify_mismatch", face: r.face, count: r.count });
        return;
      case "unreadable":
        setVerifyError(faceUnreadableRu());
        reader.resetVerify();
        return;
      case "assign":
        setVerifyError(faceUnreadableRu());
        reader.resetVerify();
        return;
      case "ambiguous":
        setVerifyError(rotationAmbiguousRu());
        reader.resetVerify();
        return;
      case "illegal":
      case "resolve":
        setVerifyError(rotationFailedRu());
        reader.resetVerify();
        return;
    }
  };

  const gotoVerify = async (): Promise<void> => {
    await startCamera();
    dispatch({ type: "goto_verify" });
  };

  const backToWalkthrough = (): void => {
    setVerifyError(null);
    reader.resetVerify();
    dispatch({ type: "back_to_walkthrough" });
  };

  const again = (): void => {
    getFsm().reset();
    reader.resetVerify();
    setVerifyError(null);
    setLiveMs(0);
    setSaveState("idle");
    savedRef.current = false;
    scramble.regenerate();
    dispatch({ type: "again" });
  };

  const timerSeconds =
    state.phase === "solving"
      ? (liveMs / 1000).toFixed(2)
      : state.phase === "result"
        ? (state.elapsedMs / 1000).toFixed(2)
        : "0.00";

  return {
    state,
    videoRef,
    overlayRef,
    workRef,
    scramble: scramble.scramble,
    moves: scramble.moves,
    scrambleLoading: scramble.loading,
    scrambleError: scramble.error,
    canVerify: scramble.expectedFacelets !== null,
    regenerateScramble: scramble.regenerate,
    cameraStarted,
    cameraError,
    startCamera,
    calibrationStep: reader.calibrationStep,
    calibrated: reader.calibrated,
    collecting: reader.collecting,
    verifyFacesLength: reader.verifyFacesLength,
    verifyError,
    captureCalibration,
    recalibrate,
    verifyStep,
    gotoVerify,
    backToWalkthrough,
    again,
    timerSeconds,
    saveState,
  };
}
