// Camera plumbing, ported from prototype/camera.ts. getUserMedia at ideal 60fps,
// bound to a <video>, driving a requestVideoFrameCallback loop that hands each
// frame to a callback WITH a performance.now()-domain timestamp.
//
// TIMEBASE (plan #4): we ONLY use the DOMHighResTimeStamp `now` arg so the timer
// and FSM share one clock; we never touch meta.mediaTime.
//
// rVFC teardown (skeptic HIGH #2): the id is stored, cancel* is called on stop(),
// a `running` flag is checked before every re-register AND before detect, the loop
// bails while readyState<2, and rVFC is feature-detected with a rAF fallback.
//
// MIRRORING: detection runs on the RAW frame; only the on-screen <video>/overlay
// is CSS-mirrored. Handedness flipping for the UI happens in useHands.

import { useRef, type RefObject } from "react";
import { config } from "../config";

export interface FrameInfo {
  video: HTMLVideoElement; // raw, un-mirrored source for detection
  nowTs: DOMHighResTimeStamp; // performance.now()-domain timestamp of this frame
  width: number;
  height: number;
}

export type FrameCallback = (info: FrameInfo) => void;

export type CameraErrorKind =
  "denied" | "not-found" | "in-use" | "unsupported" | "insecure" | "unknown";

export class CameraError extends Error {
  kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "CameraError";
  }
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: DOMHighResTimeStamp, meta: unknown) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class Camera {
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private rafHandle: number | null = null;
  private rvfcHandle: number | null = null;
  private running = false;
  private onLost?: () => void;
  // Идущий запуск. Без него два параллельных вызова start() (StrictMode-двойной
  // эффект, эффект + клик по кнопке) дерутся за устройство: второй сносит
  // ЖИВОЙ поток первого (stop() ниже) и заново просит getUserMedia — в Safari
  // такой повторный запрос отклоняется, и на экране остаётся работающее видео
  // с красной надписью «нет доступа к камере». Реальный багрепорт.
  private starting: Promise<void> | null = null;

  constructor(video: HTMLVideoElement, onLost?: () => void) {
    this.video = video;
    this.onLost = onLost;
  }

  /** True while a stream is attached and its video track is still live. */
  isLive(): boolean {
    const track = this.stream?.getVideoTracks()[0];
    return this.running && track?.readyState === "live";
  }

  async start(cb: FrameCallback): Promise<void> {
    // Уже идёт запуск — ждём его, а не начинаем второй.
    if (this.starting) return this.starting;
    // Уже живём — ничего не трогаем: повторный getUserMedia только всё сломает.
    if (this.isLive()) return;
    this.starting = this.acquire(cb).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async acquire(cb: FrameCallback): Promise<void> {
    if (!window.isSecureContext) {
      throw new CameraError("insecure", "getUserMedia needs a secure (https) context");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("unsupported", "getUserMedia not available in this browser");
    }
    // Re-acquire cleanly: drop any prior (possibly dead) stream so a retry never
    // hits NotReadableError "in-use" against our own stale tracks.
    if (this.stream) this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          frameRate: { ideal: config.CAMERA_FRAMERATE_IDEAL },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (e) {
      throw mapGetUserMediaError(e as DOMException);
    }

    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    await this.video.play();

    // Best-effort: pin exposure + white balance so a seeded colour profile / quick
    // adjust isn't chased by the camera's auto-WB drifting the observed white after
    // calibration. Unsupported constraints reject or no-op on most devices — we
    // swallow every failure (never crash the camera over a nice-to-have lock).
    void lockExposureAndWhiteBalance(this.stream);

    this.running = true;

    // If the OS/another app drops the device (or the track otherwise ends), the
    // stream is dead but our loop can't tell. Surface it so the UI can offer a
    // restart instead of forcing a page reload.
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (!this.running) return;
        this.running = false;
        this.onLost?.();
      });
    }
    const v = this.video as VideoWithRvfc;

    if (typeof v.requestVideoFrameCallback === "function") {
      const loop = (now: DOMHighResTimeStamp) => {
        if (!this.running) return;
        if (this.video.readyState >= 2) {
          cb({
            video: this.video,
            nowTs: now,
            width: this.video.videoWidth,
            height: this.video.videoHeight,
          });
        }
        if (!this.running) return;
        this.rvfcHandle = v.requestVideoFrameCallback!(loop);
      };
      this.rvfcHandle = v.requestVideoFrameCallback(loop);
    } else {
      // Fallback: rAF. Timestamp is still performance.now() domain; frame boundary
      // is looser -> lower timer precision (e.g. some Firefox builds).
      console.warn(
        "requestVideoFrameCallback unavailable; falling back to requestAnimationFrame (reduced timer precision)",
      );
      const loop = (now: DOMHighResTimeStamp) => {
        if (!this.running) return;
        if (this.video.readyState >= 2) {
          cb({
            video: this.video,
            nowTs: now,
            width: this.video.videoWidth,
            height: this.video.videoHeight,
          });
        }
        if (!this.running) return;
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    const v = this.video as VideoWithRvfc;
    if (this.rvfcHandle !== null && typeof v.cancelVideoFrameCallback === "function") {
      v.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

// Best-effort manual exposure/WB lock. These are non-standard MediaTrack
// constraints (ImageCapture spec, partial Chromium support). We probe the track
// capabilities and only request modes it advertises, then swallow any rejection —
// on Safari/Firefox/most cameras this is simply a no-op.
async function lockExposureAndWhiteBalance(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== "function") return;
  try {
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const advanced: Record<string, unknown>[] = [];
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("manual")) {
      advanced.push({ exposureMode: "manual" });
    }
    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("manual")) {
      advanced.push({ whiteBalanceMode: "manual" });
    }
    if (advanced.length === 0) return;
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
  } catch {
    /* unsupported / overconstrained — auto mode stays; not fatal. */
  }
}

function mapGetUserMediaError(e: DOMException): CameraError {
  switch (e.name) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraError("denied", "Camera permission denied");
    case "NotFoundError":
    case "OverconstrainedError":
      return new CameraError("not-found", "No camera matching constraints");
    case "NotReadableError":
    case "AbortError":
      return new CameraError("in-use", "Camera is in use by another application");
    default:
      return new CameraError("unknown", e.message || "Unknown camera error");
  }
}

/**
 * Hook: a single Camera behind a ref, constructed lazily against `videoRef`.
 * `onLost` fires if the live track ends (device unplugged, grabbed by another
 * app, OS sleep) so the caller can reset its "started" flag and offer a restart.
 */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>, onLost?: () => void) {
  const ref = useRef<Camera | null>(null);
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;
  return {
    start: async (cb: FrameCallback): Promise<void> => {
      const el = videoRef.current;
      if (!el) throw new CameraError("unknown", "video element not mounted");
      if (!ref.current) ref.current = new Camera(el, () => onLostRef.current?.());
      await ref.current.start(cb);
    },
    stop: (): void => {
      ref.current?.stop();
    },
    isLive: (): boolean => ref.current?.isLive() ?? false,
  };
}
