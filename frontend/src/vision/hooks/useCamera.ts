// Camera plumbing (ported from prototype/camera.ts). getUserMedia at ideal 60fps,
// bind to a <video>, and drive a requestVideoFrameCallback loop that hands each
// frame to a callback WITH a timestamp in the performance.now() domain.
//
// TIMEBASE (plan #4): rVFC's callback gives the DOMHighResTimeStamp `now`
// argument (same clock as performance.now()). We ONLY use that so the timer and
// the FSM share one clock. We NEVER read meta.mediaTime.
//
// MIRRORING (plan #6): detection runs on the RAW (un-mirrored) frame. Only the
// on-screen <video>/overlay is CSS-mirrored. Handedness labels get flipped for
// the UI in hands.ts, not here.
//
// React shape: a hook exposing a stable videoRef + start(onFrame)/stop. The hook
// holds no React state — the mount effect in SoloPage owns the lifecycle and the
// StrictMode async-cancellation guard. The Camera class below is the ported unit;
// the hook just binds it to the videoRef.

import { useCallback, useRef } from "react";
import { config } from "../config";

export interface FrameInfo {
  video: HTMLVideoElement; // raw, un-mirrored source for detection
  nowTs: DOMHighResTimeStamp; // performance.now()-domain timestamp of this frame
  width: number;
  height: number;
}

export type FrameCallback = (info: FrameInfo) => void;

export type CameraErrorKind =
  | "denied"
  | "not-found"
  | "in-use"
  | "unsupported"
  | "unknown";

export class CameraError extends Error {
  kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "CameraError";
  }
}

export class Camera {
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private rafHandle: number | null = null;
  private rvfcHandle: number | null = null;
  private running = false;
  // Set by stop(). start() re-checks it after EACH await so a stop() that landed
  // mid-acquisition (route-away while getUserMedia/play was pending) tears the
  // just-resolved stream down instead of going live — otherwise the camera light
  // stays on (the classic StrictMode/route-away leak).
  private stopped = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(cb: FrameCallback): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("unsupported", "getUserMedia not available in this browser");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
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
    this.stream = stream;
    // Resolved after a stop()? Tear it down now, don't go live.
    if (this.stopped) {
      this.stop();
      return;
    }

    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    await this.video.play();
    if (this.stopped) {
      this.stop();
      return;
    }

    this.running = true;
    const anyVideo = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: DOMHighResTimeStamp, meta: unknown) => void,
      ) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    if (typeof anyVideo.requestVideoFrameCallback === "function") {
      const loop = (now: DOMHighResTimeStamp) => {
        if (!this.running) return;
        // `now` is DOMHighResTimeStamp == performance.now() domain. Do NOT read
        // meta.mediaTime — keeping a single clock is the whole point.
        cb({
          video: this.video,
          nowTs: now,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
        });
        this.rvfcHandle = anyVideo.requestVideoFrameCallback!(loop);
      };
      this.rvfcHandle = anyVideo.requestVideoFrameCallback(loop);
    } else {
      // Fallback: requestAnimationFrame. Timestamp is still performance.now()
      // domain but frame boundary is looser -> lower timer precision.
      console.warn(
        "requestVideoFrameCallback unavailable; falling back to requestAnimationFrame (reduced timer precision)",
      );
      const loop = (now: DOMHighResTimeStamp) => {
        if (!this.running) return;
        cb({
          video: this.video,
          nowTs: now,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
        });
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    const anyVideo = this.video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (this.rvfcHandle !== null && typeof anyVideo.cancelVideoFrameCallback === "function") {
      anyVideo.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
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
 * Hook: binds a Camera to a stable videoRef. Holds no React state; the caller's
 * mount effect owns the async-cancellation lifecycle (StrictMode double-mount).
 * `start(onFrame)` acquires the stream + begins the rVFC loop; `stop()` cancels
 * the loop, stops all tracks, and clears srcObject.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<Camera | null>(null);

  const start = useCallback(async (onFrame: FrameCallback): Promise<void> => {
    const video = videoRef.current;
    if (!video) throw new CameraError("unknown", "video element not mounted");
    const camera = new Camera(video);
    cameraRef.current = camera;
    await camera.start(onFrame);
  }, []);

  const stop = useCallback((): void => {
    cameraRef.current?.stop();
    cameraRef.current = null;
  }, []);

  return { videoRef, start, stop };
}
