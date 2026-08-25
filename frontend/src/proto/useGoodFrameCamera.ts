// PROTOTYPE — камера + оценка «удачного кадра» для /proto/green-frame.
// Read-only переиспользование боевого зрения: useCamera (без изменений),
// readFace/guideRegionLuma (вызываются с refs=null — без цветовой калибровки,
// см. goodFrame.ts про то, какие сигналы остаются доступны и без неё) и
// squareGuidePx/GUIDE_RECT из vision/config. Ни один боевой файл не тронут.
//
// НЕ использует MediaPipe/useHands: детекция пальца идёт через FaceSample.skin
// (та же кожная гамма, которой продукт уже бракует съёмку в pushAccuracyFace),
// а не через landmark-руки — для прототипа этого достаточно и не тянет
// отдельную модель. Осознанно оставлено на потом, см. README демо-страницы.
//
// Троттлинг: readFace(refs=null) дешевле продуктового пути (без перебора
// кандидатов подгонки — vision/faceFit.fitFaceRegion), но незачем гонять его на
// каждый видео-кадр (до 60/с). Пересчёт идёт раз в EVAL_INTERVAL_MS — сам приём
// «не мигать на каждом кадре» и есть один из найденных на ресёрче паттернов.

import { useEffect, useRef, useState, type RefObject } from "react";
import { config } from "../vision/config";
import { readFace, guideRegionLuma } from "../vision/hooks/useCubeReader";
import { useCamera, CameraError, type FrameInfo } from "../vision/hooks/useCamera";
import { cameraErrorRu } from "../vision/cameraErrors";
import { drawGoodFrameOverlay } from "./goodFrameOverlay";
import {
  GoodFrameTracker,
  classifyFrame,
  defaultThresholds,
  type FrameQuality,
  type FrameSignal,
  type GoodFrameThresholds,
} from "./goodFrame";

const EVAL_INTERVAL_MS = 100;
const IDLE_QUALITY: FrameQuality = { confidence: 0, status: "seeking", reason: null };

export interface GoodFrameCamera {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  workRef: RefObject<HTMLCanvasElement | null>;
  cameraStarted: boolean;
  cameraError: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** Текущая оценка кадра — обновляется примерно раз в EVAL_INTERVAL_MS. */
  quality: FrameQuality;
  /** Последние сырые сигналы — для отладочной панели на демо-странице. */
  lastSignal: FrameSignal | null;
  resetTracker: () => void;
  /**
   * Прямая подача вердикта мимо камеры — для режима «без камеры» (ползунок
   * уверенности на демо-странице). Использует ТУ ЖЕ гистерезис-трекер, поэтому
   * поведение дебаунса видно и без живого видео.
   */
  pushManual: (ok: boolean) => void;
}

export function useGoodFrameCamera(): GoodFrameCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [quality, setQuality] = useState<FrameQuality>(IDLE_QUALITY);
  const [lastSignal, setLastSignal] = useState<FrameSignal | null>(null);

  const camera = useCamera(videoRef, () => setCameraStarted(false));
  const trackerRef = useRef<GoodFrameTracker>(new GoodFrameTracker());
  const thresholdsRef = useRef<GoodFrameThresholds>(defaultThresholds());
  const qualityRef = useRef<FrameQuality>(IDLE_QUALITY);
  const lastEvalRef = useRef<number>(-Infinity);

  const onFrame = (info: FrameInfo): void => {
    const { video, nowTs, width, height } = info;
    if (!width || !height) return;
    const work = workRef.current;

    if (work && nowTs - lastEvalRef.current >= EVAL_INTERVAL_MS) {
      lastEvalRef.current = nowTs;
      const luma = guideRegionLuma(video, width, height, work, config.GUIDE_RECT);
      const sample = readFace(
        video,
        width,
        height,
        work,
        config.GUIDE_RECT,
        config.CELL_CENTER_FRAC,
        null, // без эталонов цвета — структурные сигналы (gap/edge/skin) не нуждаются в калибровке
        null,
      );
      const skinMax = sample.skin.length > 0 ? Math.max(...sample.skin) : 0;
      const signal: FrameSignal = { luma, gap: sample.fit.gap, edge: sample.fit.edge ?? 0, skinMax };
      const verdict = classifyFrame(signal, thresholdsRef.current);
      const q = trackerRef.current.push(verdict, nowTs);
      qualityRef.current = q;
      setQuality(q);
      setLastSignal(signal);
    }

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      const ctx = overlay.getContext("2d");
      if (ctx) drawGoodFrameOverlay(ctx, width, height, config.GUIDE_RECT, qualityRef.current);
    }
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStarted && camera.isLive()) return;
    try {
      setCameraError(null);
      await camera.start(onFrame);
      setCameraStarted(true);
    } catch (e) {
      if (camera.isLive()) {
        setCameraStarted(true);
        setCameraError(null);
        return;
      }
      setCameraError(e instanceof CameraError ? cameraErrorRu(e.kind) : "Не удалось включить камеру.");
    }
  };

  const stopCamera = (): void => {
    camera.stop();
    setCameraStarted(false);
    trackerRef.current.reset();
    qualityRef.current = IDLE_QUALITY;
    setQuality(IDLE_QUALITY);
    setLastSignal(null);
  };

  const resetTracker = (): void => {
    trackerRef.current.reset();
    qualityRef.current = IDLE_QUALITY;
    setQuality(IDLE_QUALITY);
  };

  const pushManual = (ok: boolean): void => {
    const q = trackerRef.current.push(
      { ok, reason: ok ? null : "no-lattice" },
      performance.now(),
    );
    qualityRef.current = q;
    setQuality(q);
  };

  useEffect(() => {
    return () => {
      camera.stop();
    };
    // Один раз при размонтировании — camera проксирует стабильный ref (тот же
    // приём, что и в dev/useTimingLab.ts).
  }, []);

  return {
    videoRef,
    overlayRef,
    workRef,
    cameraStarted,
    cameraError,
    startCamera,
    stopCamera,
    quality,
    lastSignal,
    resetTracker,
    pushManual,
  };
}
