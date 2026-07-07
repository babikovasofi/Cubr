// STUB hook (Stage 1.2 wires it). Wraps MediaPipe HandLandmarker
// (@mediapipe/tasks-vision, WASM + model pinned to 0.10.35 from CDN). Signature +
// lifecycle skeleton only; it does NOT drive the FSM yet. Ported behaviour lives
// in prototype/hands.ts.

export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandsInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandsInitError";
  }
}

export function useHands() {
  // Skeleton only. 1.2: init() loads FilesetResolver + HandLandmarker in a
  // useEffect, detect() runs per frame, cleanup closes the landmarker.
  async function init(): Promise<void> {
    throw new Error("useHands.init not implemented until Stage 1.2");
  }
  return { init };
}
