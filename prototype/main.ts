// Orchestration for the Stage-0 prototype. Owns the DOM; delegates all logic to
// the pure modules (camera / hands / fsm / colors / cube / cubeState / accuracy).
// This is the one file that is NOT unit-tested — it is the manual-QA surface.

import { Camera, CameraError, type FrameInfo } from "./camera.ts";
import { Hands, drawOverlay, defaultZones } from "./hands.ts";
import { HandsFsm } from "./fsm.ts";
import {
  calibrate,
  assignQuota,
  COLOR_NAMES,
  type ColorName,
  type Refs,
  type RGB,
  type Lab,
  deltaE,
} from "./colors.ts";
import { readFace, guideRegionLuma } from "./cube.ts";
import {
  randomScramble,
  scrambleToFacelets,
  validateFacelets,
  diffFacelets,
  FACE_ORDER,
  type Facelet,
} from "./cubeState.ts";
import { scoreRead, formatReport } from "./accuracy.ts";
import { config } from "./config.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const work = $<HTMLCanvasElement>("work");
const octx = overlay.getContext("2d")!;

const els = {
  fsmState: $("fsm-state"),
  timer: $("timer"),
  sanity: $("sanity"),
  report: $("report"),
  btnStart: $<HTMLButtonElement>("btn-start"),
  btnCalibrate: $<HTMLButtonElement>("btn-calibrate"),
  btnScramble: $<HTMLButtonElement>("btn-scramble"),
  btnRead: $<HTMLButtonElement>("btn-read"),
  btnAccuracy: $<HTMLButtonElement>("btn-accuracy"),
};

const camera = new Camera(video);
const hands = new Hands();
const fsm = new HandsFsm();
const zones = defaultZones();

// Session state.
let refs: Refs | null = null;
let calibrationStep = 0; // 0..5, one per face in COLOR_NAMES order
let currentScramble = "";
let expectedFacelets: Facelet | null = null;
let solveStartTs: number | null = null;
let solveElapsedMs = 0;

function log(msg: string): void {
  els.report.textContent = msg;
}
function appendLog(msg: string): void {
  els.report.textContent = `${els.report.textContent}\n${msg}`;
}

els.btnStart.addEventListener("click", async () => {
  els.btnStart.disabled = true;
  els.btnStart.textContent = "Starting…";
  try {
    await hands.init();
    hands.setZones(zones);
    await camera.start(onFrame);
    els.btnStart.textContent = "Camera running";
    els.btnCalibrate.disabled = false;
    els.btnScramble.disabled = false;
    els.btnRead.disabled = false;
    els.btnAccuracy.disabled = false;
    log(`Camera running. Calibrate all 6 faces (order: ${COLOR_NAMES.join(" ")}). Next: ${COLOR_NAMES[0]}.`);
  } catch (e) {
    const err = e as CameraError;
    els.btnStart.disabled = false;
    els.btnStart.textContent = "Start camera";
    log(`Camera error (${err.kind ?? "unknown"}): ${err.message}`);
  }
});

els.btnCalibrate.addEventListener("click", () => {
  if (calibrationStep >= COLOR_NAMES.length) {
    log("All 6 faces already calibrated. Use New scramble to continue.");
    return;
  }
  const w = video.videoWidth;
  const h = video.videoHeight;
  const face = readFace(video, w, h, work);
  const name = COLOR_NAMES[calibrationStep];
  // Center sticker (cell 4) is the reference for this solved face.
  calibrationRefsRgb[name] = face.rgb[4];
  calibrationStep++;
  if (calibrationStep < COLOR_NAMES.length) {
    log(`Captured face ${name}. Next: ${COLOR_NAMES[calibrationStep]} (${calibrationStep + 1}/6).`);
  } else {
    refs = calibrate(calibrationRefsRgb as Record<ColorName, RGB>);
    const gate = redOrangeGate(refs);
    log(`Calibration complete. red/orange ΔE = ${gate.de.toFixed(1)} -> ${gate.ok ? "ok" : "TOO CLOSE, change light"}.`);
  }
});

const calibrationRefsRgb: Partial<Record<ColorName, RGB>> = {};

els.btnScramble.addEventListener("click", () => {
  currentScramble = randomScramble();
  expectedFacelets = scrambleToFacelets(currentScramble);
  const v = validateFacelets(expectedFacelets);
  log(`Scramble: ${currentScramble}\nExpected state valid: ${v.ok}${v.reason ? " (" + v.reason + ")" : ""}\nApply it to your cube, then Read each face.`);
});

els.btnRead.addEventListener("click", () => {
  if (!refs) {
    log("Calibrate all 6 faces first.");
    return;
  }
  // Sanity gate: frame luma.
  const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
  if (luma < config.MIN_FRAME_LUMA || luma > config.MAX_FRAME_LUMA) {
    log(`Frame luma ${luma.toFixed(0)} outside [${config.MIN_FRAME_LUMA}, ${config.MAX_FRAME_LUMA}] — change light before reading.`);
    return;
  }
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  // Single-face independent read (quota needs all 54 — used in accuracy gate).
  const names = face.lab.map((lab) => argminRef(lab, refs!));
  log(`Read (center=${names[4]}): ${names.join(" ")}`);
});

els.btnAccuracy.addEventListener("click", () => {
  runAccuracyGate();
});

// The accuracy gate reads 6 faces interactively. For a manual run we prompt the
// tester face-by-face; here we collect 54 stickers then score vs cubejs truth.
let gateFaces: Lab[][] = [];
let gateCollecting = false;

function runAccuracyGate(): void {
  if (!refs) {
    log("Calibrate first.");
    return;
  }
  if (!expectedFacelets) {
    log("Generate a scramble first (New scramble), then apply it to the cube.");
    return;
  }
  if (!gateCollecting) {
    gateFaces = [];
    gateCollecting = true;
    log(`Accuracy gate: capture 6 faces in URFDLB order (${FACE_ORDER.join(" ")}). Press Run accuracy gate for each face. Face 1/6: ${FACE_ORDER[0]}.`);
    return;
  }
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  gateFaces.push(face.lab);
  if (gateFaces.length < 6) {
    appendLog(`Captured ${FACE_ORDER[gateFaces.length - 1]}. Next face ${gateFaces.length + 1}/6: ${FACE_ORDER[gateFaces.length]}.`);
    return;
  }
  // All 6 faces captured -> 54 labs. Centers are indices 4,13,22,31,40,49.
  gateCollecting = false;
  const labs: Lab[] = gateFaces.flat();
  const centerIdx = [4, 13, 22, 31, 40, 49];
  const quota = assignQuota(labs, refs, centerIdx);
  const read: Facelet = quota.assignment.join("");
  const valid = validateFacelets(read);
  if (!quota.balanced || !valid.ok) {
    // FAIL LOUD — do not silently emit an illegal cube.
    appendLog(`\nQUOTA/VALIDATION FAILED. balanced=${quota.balanced}, valid=${valid.ok} (${valid.reason ?? ""}). counts=${JSON.stringify(quota.counts)}`);
    appendLog("This is an observable data point (greedy missed / bad light), not a crash.");
    return;
  }
  const rep = scoreRead(read, expectedFacelets);
  const diffs = diffFacelets(read, expectedFacelets);
  appendLog("\n" + formatReport(rep));
  if (diffs.length) {
    appendLog(`\nFirst mismatch: ${diffs[0].face}[${diffs[0].cellInFace}] read ${diffs[0].read} expected ${diffs[0].expected}`);
  }
}

function argminRef(lab: Lab, r: Refs): ColorName {
  let best = COLOR_NAMES[0];
  let bestD = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaE(lab, r[name]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

function redOrangeGate(r: Refs): { de: number; ok: boolean } {
  // R=red-ish, F=front — in a standard scheme R and F are the red/orange pair on
  // many cubes; the meaningful check is the MINIMUM ΔE between any two refs.
  let minDe = Infinity;
  for (let i = 0; i < COLOR_NAMES.length; i++) {
    for (let j = i + 1; j < COLOR_NAMES.length; j++) {
      const d = deltaE(r[COLOR_NAMES[i]], r[COLOR_NAMES[j]]);
      if (d < minDe) minDe = d;
    }
  }
  return { de: minDe, ok: minDe >= config.MIN_RED_ORANGE_DE };
}

// ---- Per-frame loop --------------------------------------------------------

function onFrame(info: FrameInfo): void {
  const { video: v, nowTs, width, height } = info;
  if (width === 0 || height === 0) return;

  overlay.width = width;
  overlay.height = height;

  const obs = hands.detect(v, nowTs);
  const res = fsm.step({
    t: nowTs,
    handsDetected: obs.handsDetected,
    bothInZone: obs.bothInZone,
    still: obs.still,
    handsOutOfZone: obs.handsOutOfZone,
  });

  // Single-clock timer, driven by rVFC's performance.now()-domain timestamp.
  if (res.event === "solve_start") {
    solveStartTs = nowTs;
  } else if (res.event === "solve_stop" && solveStartTs !== null) {
    solveElapsedMs = nowTs - solveStartTs;
    solveStartTs = null;
  } else if (res.event === "abort") {
    solveStartTs = null;
    appendLog("FSM ABORT: detection lost — cycle reset.");
  }
  if (solveStartTs !== null) solveElapsedMs = nowTs - solveStartTs;

  els.fsmState.textContent = res.state;
  els.timer.textContent = (solveElapsedMs / 1000).toFixed(3);

  drawOverlay(octx, width, height, obs, zones, config.GUIDE_RECT);
}
