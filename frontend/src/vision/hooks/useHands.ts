// MediaPipe HandLandmarker wrapper (ported from prototype/hands.ts). Uses the
// CURRENT @mediapipe/tasks-vision API (NOT the legacy @mediapipe/hands). Produces
// the per-frame observation the FSM consumes: bothInZone, scale-invariant
// stillness, and handsOutOfZone.
//
// SCALE-INVARIANT STILLNESS (plan #3): landmarks are already normalized to 0..1.
// We divide inter-frame motion by hand size (landmark 0 wrist <-> 9 middle-MCP
// distance), so the stillness threshold is a FRACTION OF HAND SIZE, not raw
// pixels. Motion is matched to the SAME hand across frames by its raw handedness
// label (MediaPipe does not guarantee array-slot stability).
//
// MIRRORING (plan #6): detection runs on the RAW frame. The video is only
// CSS-mirrored on screen, so MediaPipe's handedness ("Left"/"Right") is correct
// for the raw frame but must be FLIPPED before labelling the mirrored UI.
//
// React shape: a hook exposing a stable Hands instance (via ref) + init/detect/
// drawOverlay. init() is idempotent. Holds no React state; SoloPage's mount
// effect owns the async-cancellation lifecycle and calls close() on cleanup.

import { useCallback, useRef } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { config, type Rect } from "../config";

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

// Two zones at the bottom of the frame (left half / right half).
export function defaultZones(): { left: Rect; right: Rect } {
  return {
    left: { x: 0.05, y: 0.62, w: 0.4, h: 0.33 },
    right: { x: 0.55, y: 0.62, w: 0.4, h: 0.33 },
  };
}

const WRIST = 0;
const MIDDLE_MCP = 9;

// Raised when the WASM/model download or landmarker construction fails — this is
// a NETWORK/CDN problem, distinct from a camera-permission failure, so the caller
// can show the right message ("model download failed", not "Camera error").
export class HandsInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandsInitError";
  }
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function flipHandedness(label: string): string {
  if (label === "Left") return "Right";
  if (label === "Right") return "Left";
  return label;
}

export class Hands {
  private landmarker: HandLandmarker | null = null;
  private zones = defaultZones();
  // Previous-frame landmarks keyed by RAW handedness label ("Left"/"Right"), so
  // motion is measured hand-vs-same-hand across frames. MediaPipe does NOT
  // guarantee array-slot stability, so slot-pairing would compare a hand to the
  // OTHER hand on a swap and falsely report motion.
  private prevByHand: Map<string, Landmark[]> = new Map();

  /** Load WASM + model. Idempotent: a second call is a no-op if already loaded. */
  async init(): Promise<void> {
    if (this.landmarker) return;
    // WASM fileset pinned to the installed package version (0.10.35) via CDN so
    // JS and WASM stay in sync. Model from Google's hosted store. Both are network
    // fetches -> wrap as HandsInitError so a CDN/offline failure is not mistaken
    // for a camera error upstream.
    try {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: "GPU",
        },
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

  /** Free the landmarker + reset stillness history. Safe to call more than once. */
  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.prevByHand.clear();
  }

  /** Detect on the RAW video frame at time `nowTs` (performance.now domain). */
  detect(video: HTMLVideoElement, nowTs: number): HandObservation {
    if (!this.landmarker) {
      return { handsDetected: false, bothInZone: false, still: false, handsOutOfZone: 0, hands: [] };
    }
    const res: HandLandmarkerResult = this.landmarker.detectForVideo(video, nowTs);
    const hands = res.landmarks.map((lms, i) => {
      const landmarks: Landmark[] = lms.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const cx = landmarks[WRIST].x;
      const cy = landmarks[WRIST].y;
      const px = landmarks[MIDDLE_MCP].x;
      const py = landmarks[MIDDLE_MCP].y;
      const palmX = (cx + px) / 2;
      const palmY = (cy + py) / 2;
      const inLeft = inRect(palmX, palmY, this.zones.left);
      const inRight = inRect(palmX, palmY, this.zones.right);
      const handednessRaw = res.handedness[i]?.[0]?.categoryName ?? "Unknown";
      return {
        landmarks,
        handednessRaw,
        handednessUi: flipHandedness(handednessRaw),
        inZone: inLeft || inRight,
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

  // Scale-invariant motion: mean landmark displacement / hand size, matched to
  // the SAME hand across frames by its raw handedness label (not array slot).
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
        allStill = false; // need a matching previous frame for this hand
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

function dist2d(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---- Overlay drawing -------------------------------------------------------

export interface OverlayLabels {
  guide: string; // over the cube guide-rect, e.g. "Держи кубик здесь"
  left: string; // over the left hand zone
  right: string; // over the right hand zone
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  obs: HandObservation,
  zones: { left: Rect; right: Rect },
  guide: Rect,
  labels?: OverlayLabels,
): void {
  ctx.clearRect(0, 0, w, h);

  // Zones.
  for (const z of [zones.left, zones.right]) {
    ctx.strokeStyle = "#39d98a";
    ctx.lineWidth = 2;
    ctx.strokeRect(z.x * w, z.y * h, z.w * w, z.h * h);
  }

  // Guide frame for cube face.
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 3;
  ctx.strokeRect(guide.x * w, guide.y * h, guide.w * w, guide.h * h);
  // Mark the U-edge (top) so the tester knows which way is up.
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(guide.x * w, guide.y * h - 6, guide.w * w, 4);

  // Russian labels. The overlay canvas is CSS-mirrored (scaleX(-1)); a plain
  // fillText would render Cyrillic BACKWARDS. Draw each label inside a local
  // horizontal-flip transform so the text reads forward on screen.
  if (labels) {
    ctx.textBaseline = "bottom";
    ctx.font = "600 16px system-ui, sans-serif";
    const label = (text: string, x: number, y: number, color: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1); // cancel the CSS mirror locally
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label(labels.guide, (guide.x + guide.w) * w, guide.y * h - 8, "#ffd23f");
    label(labels.left, (zones.left.x + zones.left.w) * w, zones.left.y * h - 4, "#39d98a");
    label(labels.right, (zones.right.x + zones.right.w) * w, zones.right.y * h - 4, "#39d98a");
  }

  // Landmarks.
  for (const hand of obs.hands) {
    ctx.fillStyle = hand.inZone ? "#39d98a" : "#ff5964";
    for (const lm of hand.landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Hook: binds a Hands instance (via ref) with a stable init/detect/close/setZones
 * surface. Idempotent init(); holds no React state. The caller's mount effect
 * owns the async-cancellation lifecycle and calls close() on cleanup.
 */
export function useHands() {
  const handsRef = useRef<Hands | null>(null);

  const getHands = useCallback((): Hands => {
    if (!handsRef.current) handsRef.current = new Hands();
    return handsRef.current;
  }, []);

  const init = useCallback(async (): Promise<void> => {
    await getHands().init();
  }, [getHands]);

  const detect = useCallback(
    (video: HTMLVideoElement, nowTs: number): HandObservation => getHands().detect(video, nowTs),
    [getHands],
  );

  const setZones = useCallback(
    (zones: { left: Rect; right: Rect }): void => getHands().setZones(zones),
    [getHands],
  );

  const close = useCallback((): void => {
    handsRef.current?.close();
    handsRef.current = null;
  }, []);

  return { handsRef, getHands, init, detect, setZones, close };
}
