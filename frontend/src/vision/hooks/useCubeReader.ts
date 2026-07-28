// Canvas-bound cube-face readers (extracted from the prototype's cube.ts). These
// touch getContext/getImageData, so they live in a hook module, not the pure
// cubeGrid. Stage 1.2 adds the stateful part: a minimal inline quick-calibrate
// (6 solved faces → session refs) and a 6-face verify collector that resolves the
// read into a legal cube and diffs it against the scramble's expected facelets.

import { useRef, useState } from "react";
import {
  calibrateByColorIdentity,
  COLOR_NAMES,
  assignQuota,
  deltaE,
  robustCellColor,
  normalizeFaceByCenter,
  rgb2lab,
  type ColorName,
  type Lab,
  type Refs,
  type RGB,
} from "../colors";
import { quickAdjust as colorsQuickAdjust } from "../quickAdjust";
import { config, squareGuidePx, type Rect } from "../config";
import { assignFacesByCenter, resolveRotations, lenientVerify } from "../cubeGrid";
import { diffFacelets, validateFacelets, type Face, type Facelet } from "../cubeState";

export interface FaceSample {
  rgb: RGB[]; // 9 median RGBs, grid order 0..8 (row-major, TL..BR)
  lab: Lab[]; // same, in Lab
  /** Доля пикселей, переживших отбраковку бликов/теней в каждой ячейке (0..1). */
  kept: number[];
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
  // Sample a CENTERED SQUARE (side = min of the guide's px dimensions). The 3x3
  // grid below assumes a square cube face fills the region; if the sampled region
  // is wider than tall (guide rect aspect and/or a landscape camera), the left/
  // right sticker COLUMNS fall off the cube onto the background — which is why a
  // solved cube read ~70% wrong at verify while calibration (which only reads the
  // CENTER cell) always worked first try. Forcing a square makes all 9 cells land
  // on the cube like the center one.
  const { gx, gy, gw, gh } = squareGuidePx(guide, w, h);

  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);

  // Distribute the pixel remainder so all gw x gh pixels are covered.
  const xEdges = [0, Math.round(gw / 3), Math.round((2 * gw) / 3), gw];
  const yEdges = [0, Math.round(gh / 3), Math.round((2 * gh) / 3), gh];

  const rgb: RGB[] = [];
  const lab: Lab[] = [];
  const kept: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = xEdges[col];
      const cy = yEdges[row];
      const cellW = xEdges[col + 1] - cx;
      const cellH = yEdges[row + 1] - cy;
      const data = ctx.getImageData(cx, cy, cellW, cellH).data;
      const cell = robustCellColor(data, cellW, cellH, centerFrac);
      kept.push(cell.kept);
      rgb.push(cell.rgb);
      lab.push(rgb2lab(cell.rgb));
    }
  }
  return { rgb, lab, kept };
}

/** Mean luma (Rec. 601) of the guide region, 0..255. */
export function guideRegionLuma(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
): number {
  const { gx, gy, gw, gh } = squareGuidePx(guide, w, h);
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
  /**
   * СЫРОЕ чтение: независимый argmin по несглаженным цветам, без нормировки и
   * без квот. Это то, что меряет гейт 0.3 — планка по самому зрению, а не по
   * подпоркам поверх него.
   */
  rawFaceGrids: Face[][];
  /**
   * ПРОДУКТОВОЕ чтение: пер-грань нормировка света + квоты 9×6. Именно оно
   * идёт в сверку скрамбла и в сборку кубика.
   */
  productFaceGrids: Face[][];
  resolved: Facelet | null; // legality-resolved URFDLB string, or null on failure
  reason?: ResolveReason; // set iff resolve/validate did not produce a legal cube
}

/**
 * Классификация 54 наклеек с КВОТАМИ 9×6 вместо независимого argmin.
 *
 * На полном чтении шести граней известно жёсткое ограничение: каждого цвета
 * ровно девять, а центры вообще однозначны (центр не двигается). Независимый
 * argmin этим не пользуется — одна пересвеченная белая наклейка спокойно
 * читается как красная, и красных становится десять. Квоты вытесняют наименее
 * уверенное чтение туда, где ещё есть место, и ровно такие одиночные промахи
 * (белая→красная в багрепорте) уходят.
 *
 * Возврат к argmin — только если центры не разложились по шести цветам: тогда
 * пиновать нечего и квоты применять не к чему.
 */
/**
 * Уверенность чтения наклейки: насколько ближайший эталон оторвался от второго.
 * Маленький отрыв — это не чтение, а угадывание: такую грань честнее переспросить.
 */
export function stickerConfidence(
  lab: Lab,
  refs: Refs,
): { best: ColorName; margin: number; d: number } {
  let best: ColorName = COLOR_NAMES[0];
  let d1 = Infinity;
  let d2 = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaE(lab, refs[name]);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = name;
    } else if (d < d2) {
      d2 = d;
    }
  }
  return { best, margin: d2 - d1, d: d1 };
}

/** Сколько ячеек грани прочитаны уверенно (см. config.STICKER_*). */
export function confidentCells(labs: Lab[], refs: Refs, kept: number[]): number {
  let n = 0;
  for (let i = 0; i < labs.length; i++) {
    const { margin, d } = stickerConfidence(labs[i], refs);
    const reliablePixels = (kept[i] ?? 1) >= config.CELL_MIN_KEPT_FRAC;
    if (reliablePixels && margin >= config.STICKER_MARGIN_MIN && d <= config.STICKER_MAX_DELTA_E) {
      n++;
    }
  }
  return n;
}

function classifyWithQuota(faces: Lab[][], refs: Refs, centers: Face[] | null): Face[][] {
  const argminGrids = (): Face[][] =>
    faces.map((grid) => grid.map((lab) => argminRef(lab, refs) as string as Face));
  if (!centers || faces.length !== 6) return argminGrids();

  const labs: Lab[] = [];
  for (const grid of faces) labs.push(...grid);

  // centerIdx в порядке COLOR_NAMES: индекс центра каждой грани в плоском массиве.
  const centerIdx: number[] = [];
  for (const name of COLOR_NAMES) {
    const cap = centers.indexOf(name as string as Face);
    if (cap < 0) return argminGrids();
    centerIdx.push(cap * 9 + 4);
  }

  const { assignment } = assignQuota(labs, refs, centerIdx);
  const out: Face[][] = [];
  for (let cap = 0; cap < faces.length; cap++) {
    out.push(assignment.slice(cap * 9, cap * 9 + 9) as string[] as Face[]);
  }
  return out;
}

/** Пер-грань нормировка света по собственному центру каждой снятой грани. */
export function normalizeSamples(samples: FaceSample[], refs: Refs): Lab[][] {
  return samples.map((sample) => {
    const centerName = argminRef(sample.lab[4], refs);
    return normalizeFaceByCenter(sample.rgb, refs[centerName]).map((rgb) => rgb2lab(rgb));
  });
}

function resolveSixFaces(samples: FaceSample[], refs: Refs): SixFaceResolve {
  const rawLabs = samples.map((s) => s.lab);
  const rawFaceGrids: Face[][] = rawLabs.map((grid) =>
    grid.map((lab) => argminRef(lab, refs) as string as Face),
  );

  const labs = normalizeSamples(samples, refs);
  const assign = assignFacesByCenter(labs, refs);
  const productFaceGrids = classifyWithQuota(labs, refs, assign.ok ? assign.faces : null);

  if (!assign.ok) return { rawFaceGrids, productFaceGrids, resolved: null, reason: "assign" };
  const res = resolveRotations(productFaceGrids, assign.faces);
  if (!res.ok) {
    return {
      rawFaceGrids,
      productFaceGrids,
      resolved: null,
      reason: res.reason?.includes("ambiguous") ? "ambiguous" : "resolve",
    };
  }
  const read = res.facelets!;
  if (!validateFacelets(read).ok) {
    return { rawFaceGrids, productFaceGrids, resolved: read, reason: "illegal" };
  }
  return { rawFaceGrids, productFaceGrids, resolved: read };
}

// An accuracy capture outcome (fixed capture order, known ground truth). Drift is
// checked per-face at capture so the tester re-shows a drifted face instead of
// silently measuring calibration error. `complete` carries the raw grids for the
// harness to assemble + score against an INDEPENDENT ground truth.
export type AccuracyCapture =
  | { kind: "pending"; facesLength: number; drifted?: { face: Face; de: number } }
  | { kind: "unreadable" } // luma/refs gate failed
  | {
      kind: "complete";
      rawFaceGrids: Face[][]; // 6 × 9 сырое чтение в фиксированном порядке URFDLB
      productFaceGrids: Face[][]; // то же, но продуктовым путём (нормировка + квоты)
      resolved: Facelet | null; // informational legality-resolve (NOT scored)
      resolveReason?: ResolveReason;
      drifted?: { face: Face; de: number }; // last face drifted > threshold (advisory, not a block)
    };

// Quick-adjust outcome (one white face). `ok` applied a session-local von-Kries
// gain; `wrong-face`/`diverged` leave the seeded refs untouched and the caller
// routes to full 6-face recalibration (skeptic HIGH#3). `unreadable` = light/refs gate.
export type QuickAdjustResult =
  | { kind: "ok" }
  | { kind: "wrong-face"; de: number; nearestColor: ColorName }
  | { kind: "diverged"; reason: "cluster" | "margin" }
  | { kind: "unreadable" };

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
  seeded: boolean; // refs came from a stored profile (not a fresh 6-face read)
  validated: boolean; // refs passed a full 6-face registration (accuracy-worthy)
  verifyFacesLength: number; // 0..6, of the in-flight collector
  collecting: boolean;
  captureCalibration: (video: HTMLVideoElement) => boolean;
  /** Seed refs from a stored cube profile (session-local clone). validated=false. */
  seedProfile: (profile: Refs) => void;
  /** One-white-face session white-balance over seeded refs. In-memory only. */
  quickAdjust: (video: HTMLVideoElement) => QuickAdjustResult;
  /** The current calibration output (6 Lab face refs, keys U/R/F/D/L/B), or null. */
  getProfile: () => Refs | null;
  recalibrate: () => void;
  beginVerify: () => void;
  pushVerifyFace: (video: HTMLVideoElement, expected: Facelet, tolerant?: boolean) => VerifyResult;
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
  const [seeded, setSeeded] = useState(false);
  const [validated, setValidated] = useState(false);
  const [verifyFacesLength, setVerifyFacesLength] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [accFacesLength, setAccFacesLength] = useState(0);
  const [collectingAccuracy, setCollectingAccuracy] = useState(false);
  const refsRef = useRef<Refs | null>(null);
  const calibRgbRef = useRef<Partial<Record<ColorName, RGB>>>({});
  const collectorRef = useRef<FaceSample[] | null>(null);
  const accCollectorRef = useRef<FaceSample[] | null>(null);

  const readable = (video: HTMLVideoElement, work: HTMLCanvasElement): boolean => {
    if (!refsRef.current) return false;
    const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
    return luma >= config.MIN_FRAME_LUMA && luma <= config.MAX_FRAME_LUMA;
  };

  // Returns false when the guide region isn't a plausible frame to sample (too
  // dark / blown-out — the SAME luma gate `readable()` applies to quick-adjust
  // and verify, minus its refs precondition, which don't exist yet mid-6-face
  // build). This stops an empty/black frame from being captured as a "face" and
  // silently poisoning the profile (the "снял без кубика → готово" bug). Note:
  // the luma gate cannot distinguish a solved face from a well-lit empty surface
  // — that deeper presence check is the R1 vision work (see /accuracy).
  const captureCalibration = (video: HTMLVideoElement): boolean => {
    const work = workRef.current;
    if (!work) return false;
    const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
    if (luma < config.MIN_FRAME_LUMA || luma > config.MAX_FRAME_LUMA) return false;
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
      // A full 6-face registration → accuracy-worthy refs (skeptic HIGH#4).
      // Faces are collected into slots by capture order, but LABELLED by their
      // actual colour (min-cost bijection to the canonical anchors), so the user
      // may show the 6 solved faces in any order without mislabelling the refs.
      const captured = COLOR_NAMES.map((n) => calibRgbRef.current[n]!);
      refsRef.current = calibrateByColorIdentity(captured);
      setSeeded(false);
      setValidated(true);
    }
    setCalibrationStep(next);
    return true;
  };

  // Seed from a stored profile: clone so quick-adjust mutates a session-local copy,
  // never the stored profile. seeded=true, validated=false — one white face cannot
  // validate red/orange separability, so this path stays casual-only (skeptic HIGH#4).
  const seedProfile = (profile: Refs): void => {
    const clone = {} as Refs;
    for (const name of COLOR_NAMES) clone[name] = [...profile[name]] as Lab;
    refsRef.current = clone;
    calibRgbRef.current = {};
    setSeeded(true);
    setValidated(false);
    setCalibrationStep(COLOR_NAMES.length); // fully "calibrated" (6/6) from the profile
    resetVerify();
  };

  // One white face → von-Kries session white-balance. STRICTLY in-memory: never
  // calls the cubes API / PATCH color_profile (skeptic constraint #4).
  const quickAdjust = (video: HTMLVideoElement): QuickAdjustResult => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };
    const face = readFace(video, video.videoWidth, video.videoHeight, work);
    const decision = colorsQuickAdjust(refs, face.rgb);
    switch (decision.kind) {
      case "ok":
        refsRef.current = decision.refs; // session-local mutation only
        return { kind: "ok" };
      case "wrong-face":
        return { kind: "wrong-face", de: decision.nearestDE, nearestColor: decision.nearestColor };
      case "diverged":
        return { kind: "diverged", reason: decision.reason };
    }
  };

  const recalibrate = (): void => {
    calibRgbRef.current = {};
    refsRef.current = null;
    setSeeded(false);
    setValidated(false);
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

  const pushVerifyFace = (
    video: HTMLVideoElement,
    expected: Facelet,
    tolerant = false,
  ): VerifyResult => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs || !collectorRef.current) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };

    const face = readFace(video, video.videoWidth, video.videoHeight, work);

    // Пер-грань нормировка света по своему центру + порог уверенности. Грань,
    // прочитанную наугад (мало отрыва до второго цвета, блик съел ячейку),
    // честнее переспросить сразу, чем тащить её в сборку кубика: там она
    // превратится в «расходится N наклеек» без объяснения причины.
    const centerName = argminRef(face.lab[4], refs);
    const fixedRGB = normalizeFaceByCenter(face.rgb, refs[centerName]);
    const fixedLab = fixedRGB.map((rgb) => rgb2lab(rgb));
    if (confidentCells(fixedLab, refs, face.kept) < config.FACE_MIN_CONFIDENT_CELLS) {
      return { kind: "unreadable" };
    }

    // Кладём СЫРОЙ сэмпл: нормировка и квоты применяются одним местом ниже
    // (resolveSixFaces), чтобы харнесс точности мог отдельно посмотреть сырое
    // чтение и продуктовое.
    collectorRef.current.push(face);
    const n = collectorRef.current.length;
    setVerifyFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n };

    // 6 faces in. Assign each to a face by its center color, then resolve rotations.
    const faces = collectorRef.current;
    collectorRef.current = null;
    setCollecting(false);
    setVerifyFacesLength(0);

    const { productFaceGrids, resolved, reason } = resolveSixFaces(faces, refs);

    // Casual solo (tolerant): don't demand a globally-legal cube. Score the real
    // per-sticker read against `expected` face-by-face and accept within tolerance,
    // so one colour misread doesn't nuke the whole 6-face read (R1). Only OK or
    // MISMATCH ever come back here — never unreadable/assign/ambiguous/resolve.
    // Ranked (Stage 4) uses the strict path below (tolerant=false).
    if (tolerant) {
      const centers = assignFacesByCenter(normalizeSamples(faces, refs), refs).faces;
      const lm = lenientVerify(productFaceGrids, centers, expected);
      const correctFrac = (lm.totalStickers - lm.mismatches) / lm.totalStickers;
      if (correctFrac >= config.CASUAL_VERIFY_MIN_CORRECT_FRAC) return { kind: "ok" };
      return { kind: "mismatch", face: lm.worstFace, count: lm.mismatches };
    }

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
    // Drift is ADVISORY, not a block: on a real webcam the center can legitimately
    // drift > CENTER_DRIFT_DE (auto-WB/exposure) and refusing the capture just stops
    // any data from ever being collected. Capture the face anyway and surface the
    // drift as a warning so the read completes and the report quantifies the real
    // per-sticker accuracy (that IS the diagnostic we need).
    const drifted =
      de > config.CENTER_DRIFT_DE ? { face: expectedColor as string as Face, de } : undefined;

    accCollectorRef.current.push(face);
    const n = accCollectorRef.current.length;
    setAccFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n, drifted };

    const faces = accCollectorRef.current;
    accCollectorRef.current = null;
    setCollectingAccuracy(false);
    setAccFacesLength(0);

    const { rawFaceGrids, productFaceGrids, resolved, reason } = resolveSixFaces(faces, refs);
    return {
      kind: "complete",
      rawFaceGrids,
      productFaceGrids,
      resolved,
      resolveReason: reason,
      drifted,
    };
  };

  return {
    readFace,
    guideRegionLuma,
    calibrationStep,
    calibrated: refsRef.current !== null,
    seeded,
    validated,
    verifyFacesLength,
    collecting,
    captureCalibration,
    seedProfile,
    quickAdjust,
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
