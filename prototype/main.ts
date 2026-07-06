// Orchestration for the Stage-0 prototype. Owns the DOM; delegates all logic to
// the pure modules (camera / hands / fsm / colors / cube / cubeState / accuracy).
// This is the one file that is NOT unit-tested — it is the manual-QA surface.

import { Camera, CameraError, type FrameInfo } from "./camera.ts";
import { Hands, HandsInitError, drawOverlay, defaultZones } from "./hands.ts";
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
import { readFace, guideRegionLuma, assignFacesByCenter, resolveRotations } from "./cube.ts";
import {
  randomScramble,
  scrambleToFacelets,
  validateFacelets,
  diffFacelets,
  SOLVED,
  type Face,
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
  btnVerify: $<HTMLButtonElement>("btn-verify"),
  btnConfirm: $<HTMLButtonElement>("btn-confirm"),
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
// True once the pre-solve 6-face verify matched the scramble; gates the timer.
let scrambleVerified = false;

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
    els.btnVerify.disabled = false;
    els.btnConfirm.disabled = false;
    els.btnAccuracy.disabled = false;
    log(`Camera running. Calibrate all 6 faces (order: ${COLOR_NAMES.join(" ")}). Next: ${COLOR_NAMES[0]}.`);
  } catch (e) {
    els.btnStart.disabled = false;
    els.btnStart.textContent = "Start camera";
    if (e instanceof HandsInitError) {
      // Distinct from a camera failure — this is a CDN/network model download.
      log(`Model download failed: ${e.message}`);
    } else {
      const err = e as CameraError;
      log(`Camera error (${err.kind ?? "unknown"}): ${err.message}`);
    }
  }
});

els.btnCalibrate.addEventListener("click", () => {
  if (calibrationStep >= COLOR_NAMES.length) {
    log("All 6 faces already calibrated. Use New scramble to continue.");
    return;
  }
  // Recalibration invalidates any in-flight 6-face collection / verify state.
  collector = null;
  scrambleVerified = false;
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
  // New scramble also RESETS the whole mini-cycle so it is repeatable without a
  // page reload: fresh FSM, cleared timer, dropped in-flight 6-face collection.
  resetCycle();
  currentScramble = randomScramble();
  expectedFacelets = scrambleToFacelets(currentScramble);
  const v = validateFacelets(expectedFacelets);
  log(
    `Scramble: ${currentScramble}\n` +
      `Expected state valid: ${v.ok}${v.reason ? " (" + v.reason + ")" : ""}\n` +
      `Apply it, then "Verify scramble (read 6)" BEFORE solving.`,
  );
});

// Reset the repeatable cycle: FSM back to NO_HANDS, timer cleared, any partial
// 6-face collection dropped, verify/confirm gating cleared. Called on New
// scramble, on Calibrate (session change), and after a completed solve.
function resetCycle(): void {
  fsm.reset();
  solveStartTs = null;
  solveElapsedMs = 0;
  scrambleVerified = false;
  collector = null;
  els.timer.textContent = "0.000";
  els.fsmState.textContent = fsm.state;
}

els.btnRead.addEventListener("click", () => {
  if (!ensureReadable()) return;
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  // Single-face independent read (quota needs all 54 — used in accuracy gate).
  const names = face.lab.map((lab) => argminRef(lab, refs!));
  log(`Read (center=${names[4]}): ${names.join(" ")}`);
});

// ---- 6-face collection ----------------------------------------------------
// A single collector drives all three 6-face flows (verify / confirm / accuracy)
// so their state can never leak into each other. `expected` is captured at start
// so a mid-collection scramble change can be detected and rejected.

type CollectPurpose = "verify" | "confirm" | "accuracy";
interface Collector {
  purpose: CollectPurpose;
  faces: Lab[][]; // per-capture 9 Lab cells, in capture order
  expected: Facelet | null; // ground truth snapshot at collection start
}
let collector: Collector | null = null;

function beginCollection(purpose: CollectPurpose, expected: Facelet | null): void {
  collector = { purpose, faces: [], expected };
  log(
    `${purpose}: capture 6 faces (any order — auto-oriented by center color). ` +
      `Press the same button for each. Face 1/6.`,
  );
}

// Push one captured face; returns the assembled read facelets when 6 are in.
function pushFace(): { read: Facelet } | { pending: true } | { failed: string } {
  if (!ensureReadable()) return { failed: "not readable (see report)" };
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  collector!.faces.push(face.lab);
  if (collector!.faces.length < 6) {
    appendLog(`Captured ${collector!.faces.length}/6. Show the next face.`);
    return { pending: true };
  }
  // 6 faces in. (a) assign each to a face by its center color, then
  // (b) resolve rotations by global consistency into a legal 54-char string.
  const assign = assignFacesByCenter(collector!.faces, refs!);
  if (!assign.ok) {
    return { failed: `face assignment failed: ${assign.reason}` };
  }
  // Per-sticker classify each face to letters (argmin over refs), then resolve.
  const faceGrids: Face[][] = collector!.faces.map((grid) =>
    grid.map((lab) => argminRef(lab, refs!) as string as Face),
  );
  const res = resolveRotations(faceGrids, assign.faces);
  if (!res.ok) {
    return { failed: `rotation resolve failed: ${res.reason}` };
  }
  return { read: res.facelets! };
}

els.btnVerify.addEventListener("click", () => {
  if (!refs) return void log("Calibrate all 6 faces first.");
  if (!expectedFacelets) return void log("Generate a scramble first (New scramble).");
  if (!collector || collector.purpose !== "verify") {
    beginCollection("verify", expectedFacelets);
    return;
  }
  if (collector.expected !== expectedFacelets) {
    collector = null;
    return void log("Scramble changed mid-collection — verify aborted. Start over.");
  }
  const r = pushFace();
  if ("pending" in r) return;
  if ("failed" in r) {
    collector = null;
    appendLog(`\nVERIFY FAILED (FAIL LOUD): ${r.failed}. Re-capture.`);
    return;
  }
  collector = null;
  const read = r.read;
  const v = validateFacelets(read);
  if (!v.ok) {
    appendLog(`\nRead is not a legal cube: ${v.reason}. Re-capture.`);
    return;
  }
  const diffs = diffFacelets(read, expectedFacelets!);
  if (diffs.length === 0) {
    scrambleVerified = true;
    appendLog("\nSCRAMBLE VERIFIED: read matches expected. Put hands in zones to arm the timer.");
  } else {
    scrambleVerified = false;
    const d = diffs[0];
    appendLog(
      `\nSCRAMBLE MISMATCH: ${diffs.length} stickers differ. ` +
        `First: face ${d.face}[${d.cellInFace}] (idx ${d.globalIndex}) read ${d.read} expected ${d.expected}. ` +
        `Fix the cube / re-scramble before solving.`,
    );
  }
});

els.btnConfirm.addEventListener("click", () => {
  if (!refs) return void log("Calibrate all 6 faces first.");
  if (!collector || collector.purpose !== "confirm") {
    beginCollection("confirm", SOLVED);
    return;
  }
  const r = pushFace();
  if ("pending" in r) return;
  if ("failed" in r) {
    collector = null;
    appendLog(`\nCONFIRM FAILED (FAIL LOUD): ${r.failed}. Re-capture.`);
    return;
  }
  collector = null;
  const read = r.read;
  const diffs = diffFacelets(read, SOLVED);
  if (diffs.length === 0) {
    appendLog("\nSOLVED CONFIRMED: read == SOLVED. Cycle complete. New scramble to go again.");
  } else {
    const d = diffs[0];
    appendLog(
      `\nNOT SOLVED: ${diffs.length} stickers off. ` +
        `First: face ${d.face}[${d.cellInFace}] (idx ${d.globalIndex}) read ${d.read} expected ${d.expected}.`,
    );
  }
});

els.btnAccuracy.addEventListener("click", () => {
  if (!refs) return void log("Calibrate first.");
  if (!expectedFacelets) {
    return void log("Generate a scramble first (New scramble), then apply it to the cube.");
  }
  if (!collector || collector.purpose !== "accuracy") {
    beginCollection("accuracy", expectedFacelets);
    return;
  }
  if (collector.expected !== expectedFacelets) {
    collector = null;
    return void log("Scramble changed mid-collection — accuracy gate aborted. Start over.");
  }
  const expectedSnapshot = collector.expected!;
  if (!ensureReadable()) return;
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  collector.faces.push(face.lab);
  if (collector.faces.length < 6) {
    appendLog(`Captured ${collector.faces.length}/6 (URFDLB order). Next face.`);
    return;
  }
  // All 6 captured -> 54 labs, centers at 4,13,22,31,40,49 (URFDLB capture order).
  const labs: Lab[] = collector.faces.flat();
  collector = null;
  const centerIdx = [4, 13, 22, 31, 40, 49];
  const quota = assignQuota(labs, refs, centerIdx);
  const read: Facelet = quota.assignment.join("");
  const valid = validateFacelets(read);
  if (!quota.balanced || !valid.ok) {
    appendLog(`\nQUOTA/VALIDATION FAILED. balanced=${quota.balanced}, valid=${valid.ok} (${valid.reason ?? ""}). counts=${JSON.stringify(quota.counts)}`);
    appendLog("This is an observable data point (greedy missed / bad light), not a crash.");
    return;
  }
  const rep = scoreRead(read, expectedSnapshot);
  const diffs = diffFacelets(read, expectedSnapshot);
  appendLog("\n" + formatReport(rep));
  if (diffs.length) {
    appendLog(`\nFirst mismatch: ${diffs[0].face}[${diffs[0].cellInFace}] read ${diffs[0].read} expected ${diffs[0].expected}`);
  }
});

// Shared gate for any read: refs present, red/orange ΔE ok, frame luma in range.
function ensureReadable(): boolean {
  if (!refs) {
    log("Calibrate all 6 faces first.");
    return false;
  }
  const gate = redOrangeGate(refs);
  if (!gate.ok) {
    log(`Refs too close (min ΔE ${gate.de.toFixed(1)} < ${config.MIN_RED_ORANGE_DE}) — change light and re-calibrate before reading.`);
    return false;
  }
  const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
  if (luma < config.MIN_FRAME_LUMA || luma > config.MAX_FRAME_LUMA) {
    log(`Frame luma ${luma.toFixed(0)} outside [${config.MIN_FRAME_LUMA}, ${config.MAX_FRAME_LUMA}] — change light before reading.`);
    return false;
  }
  return true;
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
    if (scrambleVerified) {
      solveStartTs = nowTs;
    } else {
      // Guard: never time a solve whose scramble was not verified vs cubejs.
      appendLog("Timer NOT started: verify the scramble (read 6) first.");
    }
  } else if (res.event === "solve_stop" && solveStartTs !== null) {
    solveElapsedMs = nowTs - solveStartTs;
    solveStartTs = null;
    // Do NOT wedge at STOPPED: reset the FSM so the next mini-cycle can run
    // without a page reload. The recorded time stays on screen.
    fsm.reset();
    scrambleVerified = false;
    appendLog(
      `\nSOLVE STOPPED at ${(solveElapsedMs / 1000).toFixed(3)}s. ` +
        `Now "Confirm solved (read 6)", then "New scramble" to go again.`,
    );
  } else if (res.event === "abort") {
    solveStartTs = null;
    appendLog("FSM ABORT: detection lost — cycle reset.");
  }
  if (solveStartTs !== null) solveElapsedMs = nowTs - solveStartTs;

  els.fsmState.textContent = res.state;
  els.timer.textContent = (solveElapsedMs / 1000).toFixed(3);

  drawOverlay(octx, width, height, obs, zones, config.GUIDE_RECT);
}
