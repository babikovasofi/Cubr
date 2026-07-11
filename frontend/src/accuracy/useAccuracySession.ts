// Accuracy-run orchestrator (Stage 0.3, DEV-only). The useSoloSession pattern
// minus hands/FSM/timer/save: it owns the camera lifecycle, a guide-only overlay,
// the calibration passthrough, and the fixed-order accuracy collector. On a
// completed 6-face capture it assembles the RAW read, scores it against an
// INDEPENDENT ground truth (known scramble | SOLVED), and folds the result into a
// per-condition accumulator. Drops are counted, never discarded.

import { useEffect, useRef, useState } from "react";
import { config } from "../vision/config";
import { useCamera, CameraError, type FrameInfo, type CameraErrorKind } from "../vision/hooks/useCamera";
import { useCubeReader } from "../vision/hooks/useCubeReader";
import { useScramble } from "../scramble/hooks/useScramble";
import { scoreRead, formatReport, type AccuracyReport } from "../vision/accuracy";
import {
  appendDrop,
  appendRead,
  undoRead,
  assembleRawRead,
  formatRunSummary,
  type AccuracyRun,
  type ConditionKey,
} from "../vision/accuracyRun";
import { SOLVED, type Facelet } from "../vision/cubeState";
import { cameraDeniedRu, faceUnreadableRu } from "../vision/guide";

export type AccuracyMode = "scramble" | "solved";

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

export interface AccuracySession {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  // Camera.
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;
  // Mode + ground truth.
  mode: AccuracyMode;
  setMode: (m: AccuracyMode) => void;
  scramble: string;
  moves: string[];
  scrambleLoading: boolean;
  scrambleError: string | null;
  regenerateScramble: () => void;
  groundTruthReady: boolean;
  // Condition tag.
  condition: ConditionKey;
  setCondition: (patch: Partial<ConditionKey>) => void;
  // Calibration.
  calibrationStep: number;
  calibrated: boolean;
  captureCalibration: () => void;
  recalibrate: () => void;
  // Accuracy capture.
  collectingAccuracy: boolean;
  accFacesLength: number;
  captureError: string | null;
  captureFace: () => void;
  cancelCapture: () => void;
  excludeLast: () => void;
  // Results.
  lastReport: AccuracyReport | null;
  run: AccuracyRun;
  runVersion: number;
  resetRun: () => void;
  buildExport: () => string;
}

export function useAccuracySession(): AccuracySession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const camera = useCamera(videoRef);
  const reader = useCubeReader(workRef);
  const scramble = useScramble();

  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mode, setMode] = useState<AccuracyMode>("scramble");
  const [condition, setConditionState] = useState<ConditionKey>({
    light: "",
    cube: "",
    person: "",
    calib: "fresh",
  });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<AccuracyReport | null>(null);
  const lastReadKeyRef = useRef<ConditionKey | null>(null);

  // The accumulator lives in a ref (append* mutate in place); a version counter
  // triggers the re-render so the panel recomputes the gate.
  const runRef = useRef<AccuracyRun>(new Map());
  const [runVersion, setRunVersion] = useState(0);
  const bump = (): void => setRunVersion((v) => v + 1);

  const conditionRef = useRef(condition);
  useEffect(() => {
    conditionRef.current = condition;
  }, [condition]);

  const setCondition = (patch: Partial<ConditionKey>): void =>
    setConditionState((c) => ({ ...c, ...patch }));

  // Guide-only overlay: draw the yellow capture frame + its U-edge marker. No
  // hands, no zones — this screen only needs the cube-face guide.
  const onFrame = (info: FrameInfo): void => {
    const { width, height } = info;
    if (!width || !height) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = width;
    overlay.height = height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const g = config.GUIDE_RECT;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 3;
    ctx.strokeRect(g.x * width, g.y * height, g.w * width, g.h * height);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(g.x * width, g.y * height - 6, g.w * width, 4);
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted) return;
    try {
      setCameraError(null);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      if (e instanceof CameraError) setCameraError(cameraErrorRu(e.kind));
      else setCameraError(cameraDeniedRu());
    }
  };

  useEffect(() => {
    return () => camera.stop();
    // Run once: camera proxies to a stable ref.
  }, []);

  const groundTruth = (): Facelet | null =>
    mode === "solved" ? SOLVED : scramble.expectedFacelets;

  const captureCalibration = (): void => {
    const v = videoRef.current;
    if (v) reader.captureCalibration(v);
  };

  const recalibrate = (): void => {
    setCaptureError(null);
    reader.recalibrate();
    reader.resetAccuracy();
    setCondition({ calib: "fresh" });
  };

  const captureFace = (): void => {
    setCaptureError(null);
    if (!reader.calibrated) {
      setCaptureError("Сначала откалибруй камеру: покажи 6 граней собранного кубика.");
      return;
    }
    const truth = groundTruth();
    if (!truth) {
      setCaptureError("Нет эталона. Обнови скрамбл (или переключись в режим «собранный»).");
      return;
    }
    if (!reader.collectingAccuracy) {
      reader.beginAccuracy();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const r = reader.pushAccuracyFace(v);
    switch (r.kind) {
      case "pending":
        return;
      case "unreadable":
        setCaptureError(faceUnreadableRu());
        appendDrop(runRef.current, conditionRef.current, "unreadable");
        reader.resetAccuracy();
        bump();
        return;
      case "drift":
        // Per-face re-show: don't drop the whole read, don't advance the counter.
        setCaptureError(
          `Грань ${r.face} уплыла от калибровки (ΔE ${r.de.toFixed(1)} > ${config.CENTER_DRIFT_DE}). ` +
            `Покажи её заново ровно в рамке или откалибруйся.`,
        );
        return;
      case "complete": {
        const raw = assembleRawRead(r.rawFaceGrids);
        const report = scoreRead(raw, truth);
        appendRead(runRef.current, conditionRef.current, report);
        lastReadKeyRef.current = conditionRef.current;
        setLastReport(report);
        bump();
        return;
      }
    }
  };

  const cancelCapture = (): void => {
    setCaptureError(null);
    reader.resetAccuracy();
  };

  // Tester saw the last read was a mis-scramble/bad capture: un-merge it (keeping
  // the condition's other reads) and book it as a mis-scramble drop.
  const excludeLast = (): void => {
    if (!lastReport || !lastReadKeyRef.current) return;
    undoRead(runRef.current, lastReadKeyRef.current, lastReport, "mis-scramble");
    lastReadKeyRef.current = null;
    setLastReport(null);
    bump();
  };

  const resetRun = (): void => {
    runRef.current = new Map();
    lastReadKeyRef.current = null;
    setLastReport(null);
    bump();
  };

  const buildExport = (): string => {
    const parts: string[] = [];
    if (lastReport) {
      parts.push("=== Последнее чтение ===");
      parts.push(formatReport(lastReport));
      parts.push("");
    }
    parts.push("=== Сводка прогона ===");
    parts.push(formatRunSummary(runRef.current));
    return parts.join("\n");
  };

  return {
    videoRef,
    overlayRef,
    workRef,
    cameraStarted,
    cameraError,
    startCamera,
    mode,
    setMode,
    scramble: scramble.scramble,
    moves: scramble.moves,
    scrambleLoading: scramble.loading,
    scrambleError: scramble.error,
    regenerateScramble: scramble.regenerate,
    groundTruthReady: groundTruth() !== null,
    condition,
    setCondition,
    calibrationStep: reader.calibrationStep,
    calibrated: reader.calibrated,
    captureCalibration,
    recalibrate,
    collectingAccuracy: reader.collectingAccuracy,
    accFacesLength: reader.accFacesLength,
    captureError,
    captureFace,
    cancelCapture,
    excludeLast,
    lastReport,
    run: runRef.current,
    runVersion,
    resetRun,
    buildExport,
  };
}
