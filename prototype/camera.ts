// Camera plumbing. getUserMedia at ideal 60fps, bind to a <video>, and drive a
// requestVideoFrameCallback loop that hands each frame to a callback WITH a
// timestamp in the performance.now() domain.
//
// TIMEBASE (plan #4): rVFC's metadata gives us both `mediaTime` (media clock)
// and the DOMHighResTimeStamp `now` argument (same clock as performance.now()).
// We ONLY use the DOMHighResTimeStamp so the timer and the FSM share one clock.
// We never touch mediaTime.
//
// MIRRORING (plan): detection runs on the RAW (un-mirrored) frame. Only the
// on-screen <video>/overlay is CSS-mirrored for a natural selfie view. Handedness
// labels get flipped for the UI in hands.ts, not here.

import { config } from "./config.ts";

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
  private running = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(cb: FrameCallback): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("unsupported", "getUserMedia not available in this browser");
    }
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

    this.running = true;
    const anyVideo = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: DOMHighResTimeStamp, meta: unknown) => void,
      ) => number;
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
        anyVideo.requestVideoFrameCallback!(loop);
      };
      anyVideo.requestVideoFrameCallback(loop);
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
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
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
