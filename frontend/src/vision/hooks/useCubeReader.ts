// Canvas-bound cube-face readers (extracted from the prototype's cube.ts). These
// touch getContext/getImageData, so they live in a hook module, not the pure
// cubeGrid. Stage 1.2 adds the stateful part: a minimal inline quick-calibrate
// (6 solved faces → session refs) and a 6-face verify collector that resolves the
// read into a legal cube and diffs it against the scramble's expected facelets.

import { useRef, useState } from "react";
import {
  calibrate,
  COLOR_NAMES,
  deltaE,
  medianOfCentralRegion,
  rgb2lab,
  type ColorName,
  type Lab,
  type Refs,
  type RGB,
} from "../colors";
import { config, type Rect } from "../config";
import { assignFacesByCenter, resolveRotations } from "../cubeGrid";
import { diffFacelets, validateFacelets, type Face, type Facelet } from "../cubeState";

export interface FaceSample {
  rgb: RGB[]; // 9 median RGBs, grid order 0..8 (row-major, TL..BR)
  lab: Lab[]; // same, in Lab
}

/**
 * Read the guide-frame region of `source` as a 3x3 face.
 * `source` is the RAW (un-mirrored) video; `w`,`h` its intrinsic size.
 */
export function readFace(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
  centerFrac: number = config.CELL_CENTER_FRAC,
): FaceSample {
  const gx = Math.round(guide.x * w);
  const gy = Math.round(guide.y * h);
  const gw = Math.round(guide.w * w);
  const gh = Math.round(guide.h * h);

  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);

  // Distribute the pixel remainder so all gw x gh pixels are covered.
  const xEdges = [0, Math.round(gw / 3), Math.round((2 * gw) / 3), gw];
  const yEdges = [0, Math.round(gh / 3), Math.round((2 * gh) / 3), gh];

  const rgb: RGB[] = [];
  const lab: Lab[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = xEdges[col];
      const cy = yEdges[row];
      const cellW = xEdges[col + 1] - cx;
      const cellH = yEdges[row + 1] - cy;
      const data = ctx.getImageData(cx, cy, cellW, cellH).data;
      const med = medianOfCentralRegion(data, cellW, cellH, centerFrac);
      rgb.push(med);
      lab.push(rgb2lab(med));
    }
  }
  return { rgb, lab };
}

/** Mean luma (Rec. 601) of the guide region, 0..255. */
export function guideRegionLuma(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
): number {
  const gx = Math.round(guide.x * w);
  const gy = Math.round(guide.y * h);
  const gw = Math.round(guide.w * w);
  const gh = Math.round(guide.h * h);
  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  let sum = 0;
  const count = gw * gh;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / count;
}

function argminRef(lab: Lab, refs: Refs): ColorName {
  let best = COLOR_NAMES[0];
  let bestD = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaE(lab, refs[name]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// Shared 6-face resolve (skeptic HIGH#1): compute the RAW per-sticker argmin face
// grids ONCE, then run the legality pipeline (assignFacesByCenter → resolveRotations
// → validate) for the product/verify path. The accuracy harness consumes rawFaceGrids
// directly (it needs the pre-resolve read); verify consumes `resolved`.
type ResolveReason = "assign" | "ambiguous" | "resolve" | "illegal";
interface SixFaceResolve {
  rawFaceGrids: Face[][]; // 6 × 9 argmin face-letters, in the order given
  resolved: Facelet | null; // legality-resolved URFDLB string, or null on failure
  reason?: ResolveReason; // set iff resolve/validate did not produce a legal cube
}

function resolveSixFaces(faces: Lab[][], refs: Refs): SixFaceResolve {
  const rawFaceGrids: Face[][] = faces.map((grid) =>
    grid.map((lab) => argminRef(lab, refs) as string as Face),
  );
  const assign = assignFacesByCenter(faces, refs);
  if (!assign.ok) return { rawFaceGrids, resolved: null, reason: "assign" };
  const res = resolveRotations(rawFaceGrids, assign.faces);
  if (!res.ok) {
    return {
      rawFaceGrids,
      resolved: null,
      reason: res.reason?.includes("ambiguous") ? "ambiguous" : "resolve",
    };
  }
  const read = res.facelets!;
  if (!validateFacelets(read).ok) return { rawFaceGrids, resolved: read, reason: "illegal" };
  return { rawFaceGrids, resolved: read };
}

// An accuracy capture outcome (fixed capture order, known ground truth). Drift is
// checked per-face at capture so the tester re-shows a drifted face instead of
// silently measuring calibration error. `complete` carries the raw grids for the
// harness to assemble + score against an INDEPENDENT ground truth.
export type AccuracyCapture =
  | { kind: "pending"; facesLength: number }
  | { kind: "unreadable" } // luma/refs gate failed
  | { kind: "drift"; face: Face; de: number } // captured face center drifted → re-show
  | {
      kind: "complete";
      rawFaceGrids: Face[][]; // 6 × 9 in fixed capture order URFDLB
      resolved: Facelet | null; // informational legality-resolve (NOT scored)
      resolveReason?: ResolveReason;
    };

// A verify capture outcome. `pending` while <6 faces are in; then a terminal.
export type VerifyResult =
  | { kind: "pending"; facesLength: number }
  | { kind: "ok" }
  | { kind: "mismatch"; face: string; count: number }
  | { kind: "illegal" } // read is not a legal cube
  | { kind: "unreadable" } // light/luma/refs gate failed
  | { kind: "assign" } // two faces classified to the same center
  | { kind: "ambiguous" } // multiple legal rotations
  | { kind: "resolve" }; // no legal rotation combo

export interface CubeReader {
  readFace: typeof readFace;
  guideRegionLuma: typeof guideRegionLuma;
  calibrationStep: number; // 0..6
  calibrated: boolean;
  verifyFacesLength: number; // 0..6, of the in-flight collector
  collecting: boolean;
  captureCalibration: (video: HTMLVideoElement) => void;
  /** The current calibration output (6 Lab face refs, keys U/R/F/D/L/B), or null. */
  getProfile: () => Refs | null;
  recalibrate: () => void;
  beginVerify: () => void;
  pushVerifyFace: (video: HTMLVideoElement, expected: Facelet) => VerifyResult;
  resetVerify: () => void;
  // Accuracy-harness collector (Stage 0.3): fixed capture order, per-face drift
  // gate, raw grids exposed pre-resolve. Independent of the verify collector.
  accFacesLength: number; // 0..6, of the in-flight accuracy collector
  collectingAccuracy: boolean;
  beginAccuracy: () => void;
  pushAccuracyFace: (video: HTMLVideoElement) => AccuracyCapture;
  resetAccuracy: () => void;
}

/** Stateful reader bound to a work-canvas ref. */
export function useCubeReader(workRef: React.RefObject<HTMLCanvasElement | null>): CubeReader {
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [verifyFacesLength, setVerifyFacesLength] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [accFacesLength, setAccFacesLength] = useState(0);
  const [collectingAccuracy, setCollectingAccuracy] = useState(false);
  const refsRef = useRef<Refs | null>(null);
  const calibRgbRef = useRef<Partial<Record<ColorName, RGB>>>({});
  const collectorRef = useRef<Lab[][] | null>(null);
  const accCollectorRef = useRef<Lab[][] | null>(null);

  const readable = (video: HTMLVideoElement, work: HTMLCanvasElement): boolean => {
    if (!refsRef.current) return false;
    const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
    return luma >= config.MIN_FRAME_LUMA && luma <= config.MAX_FRAME_LUMA;
  };

  const captureCalibration = (video: HTMLVideoElement): void => {
    const work = workRef.current;
    if (!work) return;
    let step = calibrationStep;
    if (step >= COLOR_NAMES.length) {
      step = 0;
      calibRgbRef.current = {};
      refsRef.current = null;
    }
    const face = readFace(video, video.videoWidth, video.videoHeight, work);
    calibRgbRef.current[COLOR_NAMES[step]] = face.rgb[4]; // center sticker
    const next = step + 1;
    if (next >= COLOR_NAMES.length) {
      refsRef.current = calibrate(calibRgbRef.current as Record<ColorName, RGB>);
    }
    setCalibrationStep(next);
  };

  const recalibrate = (): void => {
    calibRgbRef.current = {};
    refsRef.current = null;
    setCalibrationStep(0);
    resetVerify();
  };

  const beginVerify = (): void => {
    collectorRef.current = [];
    setVerifyFacesLength(0);
    setCollecting(true);
  };

  const resetVerify = (): void => {
    collectorRef.current = null;
    setVerifyFacesLength(0);
    setCollecting(false);
  };

  const pushVerifyFace = (video: HTMLVideoElement, expected: Facelet): VerifyResult => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs || !collectorRef.current) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };

    const face = readFace(video, video.videoWidth, video.videoHeight, work);
    collectorRef.current.push(face.lab);
    const n = collectorRef.current.length;
    setVerifyFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n };

    // 6 faces in. Assign each to a face by its center color, then resolve rotations.
    const faces = collectorRef.current;
    collectorRef.current = null;
    setCollecting(false);
    setVerifyFacesLength(0);

    const { resolved, reason } = resolveSixFaces(faces, refs);
    if (reason === "assign") return { kind: "assign" };
    if (reason === "ambiguous") return { kind: "ambiguous" };
    if (reason === "resolve") return { kind: "resolve" };
    if (reason === "illegal") return { kind: "illegal" };
    const read = resolved!;
    const diffs = diffFacelets(read, expected);
    if (diffs.length === 0) return { kind: "ok" };
    return { kind: "mismatch", face: diffs[0].face, count: diffs.length };
  };

  // ---- Accuracy collector (fixed capture order URFDLB) ----------------------

  const beginAccuracy = (): void => {
    accCollectorRef.current = [];
    setAccFacesLength(0);
    setCollectingAccuracy(true);
  };

  const resetAccuracy = (): void => {
    accCollectorRef.current = null;
    setAccFacesLength(0);
    setCollectingAccuracy(false);
  };

  const pushAccuracyFace = (video: HTMLVideoElement): AccuracyCapture => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs || !accCollectorRef.current) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };

    // Fixed order: the i-th captured face IS COLOR_NAMES[i] (== FACE_ORDER[i]).
    // Enforce CENTER_DRIFT_DE against that known ref so we re-show a drifted face
    // instead of measuring calibration drift as a vision error (skeptic MED).
    const faceIndex = accCollectorRef.current.length;
    const expectedColor = COLOR_NAMES[faceIndex];
    const face = readFace(video, video.videoWidth, video.videoHeight, work);
    const de = deltaE(face.lab[4], refs[expectedColor]);
    if (de > config.CENTER_DRIFT_DE) {
      return { kind: "drift", face: expectedColor as string as Face, de };
    }

    accCollectorRef.current.push(face.lab);
    const n = accCollectorRef.current.length;
    setAccFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n };

    const faces = accCollectorRef.current;
    accCollectorRef.current = null;
    setCollectingAccuracy(false);
    setAccFacesLength(0);

    const { rawFaceGrids, resolved, reason } = resolveSixFaces(faces, refs);
    return { kind: "complete", rawFaceGrids, resolved, resolveReason: reason };
  };

  return {
    readFace,
    guideRegionLuma,
    calibrationStep,
    calibrated: refsRef.current !== null,
    verifyFacesLength,
    collecting,
    captureCalibration,
    getProfile: () => refsRef.current,
    recalibrate,
    beginVerify,
    pushVerifyFace,
    resetVerify,
    accFacesLength,
    collectingAccuracy,
    beginAccuracy,
    pushAccuracyFace,
    resetAccuracy,
  };
}
