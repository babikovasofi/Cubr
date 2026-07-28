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
import { useT } from "../i18n/t";

const ZONES = defaultZones();
// Ключи перевода: подписи рисуются на canvas в цикле кадров, поэтому язык
// подставляется в момент отрисовки (см. labelsRef ниже), а не при импорте.
const OVERLAY_LABEL_KEYS: OverlayLabels = {
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

// Hands must be detected for this many CONSECUTIVE frames before the check
// counts as confirmed. A one-way latch on a single `handsDetected` frame (the
// old behaviour) let a spurious detector frame declare "готово" with no hands
// on the table — the sustained run rejects those transients.
export const HANDS_CONFIRM_FRAMES = 8;

/** Pure hands-gate step: grow the consecutive-detected run, reset it on a miss,
 * and report `seen` once the run reaches `threshold`. Unit-tested. */
export function advanceHandsGate(
  run: number,
  detected: boolean,
  threshold: number = HANDS_CONFIRM_FRAMES,
): { run: number; seen: boolean } {
  const next = detected ? run + 1 : 0;
  return { run: next, seen: next >= threshold };
}

export interface CameraCheck {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  workRef: React.RefObject<HTMLCanvasElement | null>;
  started: boolean;
  starting: boolean;
  handsSeen: boolean;
  error: string | null;
  start: () => Promise<void>;
}

export function useCameraCheck(): CameraCheck {
  const t = useT();
  // Подписи оверлея рисуются в цикле кадров — держим их в ref, чтобы смена
  // языка не требовала перезапуска камеры.
  const labelsRef = useRef<OverlayLabels>(OVERLAY_LABEL_KEYS);
  labelsRef.current = {
    guide: t(OVERLAY_LABEL_KEYS.guide),
    left: t(OVERLAY_LABEL_KEYS.left),
    right: t(OVERLAY_LABEL_KEYS.right),
  };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const camera = useCamera(videoRef);
  const hands = useHands();

  const [started, setStarted] = useState(false);
  // Camera requested but no frame has arrived yet — UI shows «Запускаю камеру…»
  // instead of prematurely prompting for hands.
  const [starting, setStarting] = useState(false);
  const [handsSeen, setHandsSeen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consecutive frames with hands detected (resets on a miss); latches
  // `handsSeen` once it reaches HANDS_CONFIRM_FRAMES.
  const handsRunRef = useRef(0);

  const onFrame = (info: FrameInfo): void => {
    const { video, nowTs, width, height } = info;
    if (!width || !height) return;
    setStarting(false); // first real frame — camera is live
    const obs = hands.detect(video, nowTs);

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      const octx = overlay.getContext("2d");
      if (octx) drawOverlay(octx, width, height, obs, ZONES, config.GUIDE_RECT, labelsRef.current);
    }
    const gate = advanceHandsGate(handsRunRef.current, obs.handsDetected);
    handsRunRef.current = gate.run;
    if (gate.seen) setHandsSeen(true);
  };

  const start = async (): Promise<void> => {
    if (started) return;
    try {
      setError(null);
      setStarting(true);
      handsRunRef.current = 0;
      await hands.init();
      hands.setZones(ZONES);
      await camera.start(onFrame);
      setStarted(true);
    } catch (e) {
      setStarting(false);
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

  return { videoRef, overlayRef, workRef, started, starting, handsSeen, error, start };
}
