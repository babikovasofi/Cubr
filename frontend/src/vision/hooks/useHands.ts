// MediaPipe HandLandmarker wrapper (the CURRENT @mediapipe/tasks-vision API).
// Ported from prototype/hands.ts. Produces the per-frame observation the FSM
// consumes: bothInZone, scale-invariant stillness, handsOutOfZone.
//
// numHands:2 + runningMode:"VIDEO" are set EXPLICITLY (skeptic MED): the default
// numHands is 1, so the FSM would never see "both hands".
//
// StrictMode: the hook keeps a single Hands instance behind a ref and exposes
// close(); the orchestrating effect (useSoloSession) closes it on cleanup.

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { useRef } from "react";
import { config, type Rect } from "../config";
import { defaultZones } from "../overlay";

export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandObservation {
  handsDetected: boolean;
  bothInZone: boolean;
  still: boolean;
  handsOutOfZone: number;
  hands: {
    landmarks: Landmark[];
    handednessRaw: string; // MediaPipe label on the RAW frame
    handednessUi: string; // flipped for the mirrored display
    inZone: boolean;
  }[];
}

const WRIST = 0;
const MIDDLE_MCP = 9;

// Raised when the WASM/model download or landmarker construction fails — a
// NETWORK/CDN problem, distinct from a camera-permission failure.
export class HandsInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandsInitError";
  }
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function flipHandedness(label: string): string {
  if (label === "Left") return "Right";
  if (label === "Right") return "Left";
  return label;
}

function dist2d(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export class Hands {
  private landmarker: HandLandmarker | null = null;
  private zones = defaultZones();
  // Previous-frame landmarks keyed by RAW handedness label, so motion is measured
  // hand-vs-same-hand across frames (MediaPipe does not guarantee slot stability).
  private prevByHand: Map<string, Landmark[]> = new Map();

  async init(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    } catch (e) {
      throw new HandsInitError(
        `model download failed (WASM/model from CDN) — check network: ${(e as Error).message}`,
      );
    }
  }

  setZones(zones: { left: Rect; right: Rect }): void {
    this.zones = zones;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.prevByHand.clear();
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** Detect on the RAW video frame at time `nowTs` (performance.now domain). */
  detect(video: HTMLVideoElement, nowTs: number): HandObservation {
    if (!this.landmarker) {
      return { handsDetected: false, bothInZone: false, still: false, handsOutOfZone: 0, hands: [] };
    }
    const res: HandLandmarkerResult = this.landmarker.detectForVideo(video, nowTs);
    const hands = res.landmarks.map((lms, i) => {
      const landmarks: Landmark[] = lms.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const palmX = (landmarks[WRIST].x + landmarks[MIDDLE_MCP].x) / 2;
      const palmY = (landmarks[WRIST].y + landmarks[MIDDLE_MCP].y) / 2;
      const inZone =
        inRect(palmX, palmY, this.zones.left) || inRect(palmX, palmY, this.zones.right);
      const handednessRaw = res.handedness[i]?.[0]?.categoryName ?? "Unknown";
      return {
        landmarks,
        handednessRaw,
        handednessUi: flipHandedness(handednessRaw),
        inZone,
      };
    });

    const handsDetected = hands.length > 0;
    const inZoneCount = hands.filter((h) => h.inZone).length;
    const bothInZone = hands.length === 2 && inZoneCount === 2;
    const handsOutOfZone = hands.filter((h) => !h.inZone).length;
    const still = this.computeStillness(
      hands.map((h) => ({ label: h.handednessRaw, landmarks: h.landmarks })),
    );

    return { handsDetected, bothInZone, still, handsOutOfZone, hands };
  }

  // Scale-invariant motion: mean landmark displacement / hand size, matched to the
  // SAME hand across frames by its raw handedness label (not array slot).
  private computeStillness(current: { label: string; landmarks: Landmark[] }[]): boolean {
    if (current.length === 0) {
      this.prevByHand.clear();
      return false;
    }
    let allStill = true;
    let measuredAny = false;
    const nextPrev = new Map<string, Landmark[]>();

    for (const { label, landmarks: cur } of current) {
      nextPrev.set(label, cur);
      const prv = this.prevByHand.get(label);
      if (!prv || prv.length !== cur.length) {
        allStill = false;
        continue;
      }
      measuredAny = true;
      const handSize = dist2d(cur[WRIST], cur[MIDDLE_MCP]) || 1e-6;
      let sum = 0;
      for (let k = 0; k < cur.length; k++) sum += dist2d(cur[k], prv[k]);
      const frac = sum / cur.length / handSize;
      if (frac > config.STILL_MOTION_FRAC) allStill = false;
    }

    this.prevByHand = nextPrev;
    return measuredAny && allStill;
  }
}

/** Hook: a single Hands instance behind a ref + imperative API. */
export function useHands() {
  const ref = useRef<Hands | null>(null);
  const get = (): Hands => (ref.current ??= new Hands());
  return {
    init: (): Promise<void> => get().init(),
    detect: (v: HTMLVideoElement, t: number): HandObservation => get().detect(v, t),
    setZones: (z: { left: Rect; right: Rect }): void => get().setZones(z),
    close: (): void => {
      ref.current?.close();
    },
  };
}
