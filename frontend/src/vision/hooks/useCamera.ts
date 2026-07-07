// STUB hook (Stage 1.2 wires it). Camera lifecycle skeleton: acquire a
// getUserMedia stream (ideal 60fps) into a <video> ref and drive a
// requestVideoFrameCallback loop; stop tracks on cleanup. Ported behaviour lives
// in prototype/camera.ts — the real effect + StrictMode guard land in 1.2.
import { useRef } from "react";

export interface FrameInfo {
  video: HTMLVideoElement;
  nowTs: DOMHighResTimeStamp;
  width: number;
  height: number;
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Skeleton only — no effect yet. 1.2: start() in useEffect, stop() in cleanup,
  // guard against StrictMode double-invoke.
  async function start(_onFrame: (f: FrameInfo) => void): Promise<void> {
    throw new Error("useCamera.start not implemented until Stage 1.2");
  }
  function stop(): void {}

  return { videoRef, start, stop };
}
