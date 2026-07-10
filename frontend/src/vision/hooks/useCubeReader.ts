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
}

/** Stateful reader bound to a work-canvas ref. */
export function useCubeReader(workRef: React.RefObject<HTMLCanvasElement | null>): CubeReader {
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [verifyFacesLength, setVerifyFacesLength] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const refsRef = useRef<Refs | null>(null);
  const calibRgbRef = useRef<Partial<Record<ColorName, RGB>>>({});
  const collectorRef = useRef<Lab[][] | null>(null);

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

    const assign = assignFacesByCenter(faces, refs);
    if (!assign.ok) return { kind: "assign" };
    const faceGrids: Face[][] = faces.map((grid) =>
      grid.map((lab) => argminRef(lab, refs) as string as Face),
    );
    const res = resolveRotations(faceGrids, assign.faces);
    if (!res.ok) {
      return { kind: res.reason?.includes("ambiguous") ? "ambiguous" : "resolve" };
    }
    const read = res.facelets!;
    if (!validateFacelets(read).ok) return { kind: "illegal" };
    const diffs = diffFacelets(read, expected);
    if (diffs.length === 0) return { kind: "ok" };
    return { kind: "mismatch", face: diffs[0].face, count: diffs.length };
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
  };
}
