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
  | "denied"
  | "not-found"
  | "in-use"
  | "unsupported"
  | "insecure"
  | "unknown";

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

class Camera {
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private rafHandle: number | null = null;
  private rvfcHandle: number | null = null;
  private running = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(cb: FrameCallback): Promise<void> {
    if (!window.isSecureContext) {
      throw new CameraError("insecure", "getUserMedia needs a secure (https) context");
    }
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

/** Hook: a single Camera behind a ref, constructed lazily against `videoRef`. */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>) {
  const ref = useRef<Camera | null>(null);
  return {
    start: async (cb: FrameCallback): Promise<void> => {
      const el = videoRef.current;
      if (!el) throw new CameraError("unknown", "video element not mounted");
      if (!ref.current) ref.current = new Camera(el);
      await ref.current.start(cb);
    },
    stop: (): void => {
      ref.current?.stop();
    },
  };
}
