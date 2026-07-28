// Camera + 6-face calibration for cube registration. Reuses the same StrictMode-safe
// imperative-start + unmount-cleanup pattern as useCameraCheck/useSoloSession: the
// stream is started on a user action (not in an effect), and one cleanup effect
// stops the stream + closes the landmarker (stop/close are idempotent).
//
// It drives the existing reader.captureCalibration (1/6..6/6) and exposes the
// resulting profile via reader.getProfile — the exact calibrate() output, keyed
// U/R/F/D/L/B, which is what the backend color_profile expects verbatim.

import { useEffect, useRef, useState } from "react";
import { drawOverlay, defaultZones, type OverlayLabels } from "../vision/overlay";
import { config } from "../vision/config";
import {
  useCamera,
  CameraError,
  type FrameInfo,
  type CameraErrorKind,
} from "../vision/hooks/useCamera";
import { useHands, HandsInitError } from "../vision/hooks/useHands";
import { useCubeReader } from "../vision/hooks/useCubeReader";
import { cameraDeniedRu, modelFailedRu, faceUnreadableRu } from "../vision/guide";
import type { ColorProfile } from "../api/cubes";

const ZONES = defaultZones();
const OVERLAY_LABELS: OverlayLabels = {
  guide: "Грань кубика — сюда",
  left: "",
  right: "",
};

function cameraErrorRu(kind: CameraErrorKind): string {
  switch (kind) {
    case "not-found":
      return "Камера не найдена. Подключи камеру и попробуй снова.";
    case "in-use":
      return "Камера занята другим приложением. Закрой его и попробуй снова.";
    case "insecure":
      return "Камера работает только по https (или на localhost).";
    case "unsupported":
      return "Этот браузер не умеет работать с камерой. Открой в свежем Chrome или Firefox.";
    case "denied":
    default:
      return cameraDeniedRu();
  }
}

export const REGISTER_FACES = 6;

export interface CubeRegister {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  started: boolean;
  error: string | null;
  calibrationStep: number; // 0..6 faces captured
  calibrated: boolean;
  profile: ColorProfile | null;
  start: () => Promise<void>;
  capture: () => void;
  reset: () => void;
}

export function useCubeRegister(): CubeRegister {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const camera = useCamera(videoRef);
  const hands = useHands();
  const reader = useCubeReader(workRef);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  };

  const start = async (): Promise<void> => {
    if (started) return;
    try {
      setError(null);
      await hands.init();
      hands.setZones(ZONES);
      await camera.start(onFrame);
      setStarted(true);
    } catch (e) {
      // Победила параллельная попытка: поток живой, значит ошибки нет — что бы
      // ни вернул наш собственный вызов. Иначе на экране остаётся работающее
      // видео с красной надписью «нет доступа к камере».
      if (camera.isLive()) {
        setError(null);
        return;
      }
      if (e instanceof HandsInitError) setError(modelFailedRu());
      else if (e instanceof CameraError) setError(cameraErrorRu(e.kind));
      else setError(cameraDeniedRu());
    }
  };

  const capture = (): void => {
    const v = videoRef.current;
    if (!v) return;
    // Reject an empty/too-dark frame instead of registering a garbage face — the
    // "снял грань без кубика в кадре → готово" bug at cube registration.
    if (!reader.captureCalibration(v)) {
      setError(faceUnreadableRu());
      return;
    }
    setError(null);
  };

  const reset = (): void => reader.recalibrate();

  // Unmount cleanup (StrictMode-safe: stop/close are idempotent).
  useEffect(() => {
    return () => {
      camera.stop();
      hands.close();
    };
  }, []);

  return {
    videoRef,
    overlayRef,
    workRef,
    started,
    error,
    calibrationStep: reader.calibrationStep,
    calibrated: reader.calibrated,
    profile: reader.calibrated ? reader.getProfile() : null,
    start,
    capture,
    reset,
  };
}
