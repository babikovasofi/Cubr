// Onboarding camera check — reuses the existing (StrictMode-safe) useCamera +
// useHands hooks. Starts the stream imperatively on a user action, runs the hands
// detector each frame, and reports whether the camera is live and hands are seen.
// The step can only "finish" when both are true (or the user explicitly skips).

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
import { cameraDeniedRu, modelFailedRu } from "../vision/guide";

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
      return "Камера работает только по https (или на localhost).";
    case "unsupported":
      return "Этот браузер не умеет работать с камерой. Открой в свежем Chrome или Firefox.";
    case "denied":
    default:
      return cameraDeniedRu();
  }
}

export interface CameraCheck {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  started: boolean;
  handsSeen: boolean;
  error: string | null;
  start: () => Promise<void>;
}

export function useCameraCheck(): CameraCheck {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const camera = useCamera(videoRef);
  const hands = useHands();

  const [started, setStarted] = useState(false);
  const [handsSeen, setHandsSeen] = useState(false);
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
    if (obs.handsDetected) setHandsSeen(true);
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
      if (e instanceof HandsInitError) setError(modelFailedRu());
      else if (e instanceof CameraError) setError(cameraErrorRu(e.kind));
      else setError(cameraDeniedRu());
    }
  };

  // Unmount cleanup (StrictMode-safe: stop/close are idempotent).
  useEffect(() => {
    return () => {
      camera.stop();
      hands.close();
    };
  }, []);

  return { videoRef, overlayRef, workRef, started, handsSeen, error, start };
}
