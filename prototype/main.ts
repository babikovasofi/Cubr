// Orchestration for the Stage-0 prototype. Owns the DOM; delegates all logic to
// the pure modules (camera / hands / fsm / colors / cube / cubeState / accuracy).
// This is the one file that is NOT unit-tested — it is the manual-QA surface.

import { Camera, CameraError, type FrameInfo } from "./camera.ts";
import { Hands, HandsInitError, drawOverlay, defaultZones } from "./hands.ts";
import { HandsFsm } from "./fsm.ts";
import {
  calibrate,
  COLOR_NAMES,
  type ColorName,
  type Refs,
  type RGB,
  type Lab,
  deltaE,
} from "./colors.ts";
import { readFace, guideRegionLuma, assignFacesByCenter, resolveRotations, rotateGrid } from "./cube.ts";
import {
  randomScramble,
  scrambleToFacelets,
  validateFacelets,
  diffFacelets,
  SOLVED,
  type Face,
  type Facelet,
} from "./cubeState.ts";
import { formatReport, gateHandMix, gateSolved } from "./accuracy.ts";
import { config } from "./config.ts";
import {
  guideStateFor,
  cameraDeniedRu,
  modelFailedRu,
  lightBadRu,
  lumaBadRu,
  verifyMismatchRu,
  rotationAmbiguousRu,
  rotationFailedRu,
  faceUnreadableRu,
  timerBlockedRu,
  dnfRu,
  COLOR_LABELS_RU,
  type GuideState,
  type GateMode,
  type GuideSnapshot,
} from "./guide.ts";

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
  guideTitle: $("guide-title"),
  guideNow: $("guide-now"),
  guideNext: $("guide-next"),
  guideProgress: $("guide-progress"),
  resetNote: $("reset-note"),
};

const guideButtons: HTMLButtonElement[] = [
  els.btnStart,
  els.btnCalibrate,
  els.btnScramble,
  els.btnRead,
  els.btnVerify,
  els.btnConfirm,
  els.btnAccuracy,
];

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
let cameraOn = false;
let gateMode: GateMode = "handmix";
// A human-readable Russian error that takes over the guide panel until cleared
// by the next successful action. The raw English log still goes to #report.
let lastError: string | null = null;

function log(msg: string): void {
  els.report.textContent = msg;
}
function appendLog(msg: string): void {
  els.report.textContent = `${els.report.textContent}\n${msg}`;
}

// The English report is the debug channel; the Russian guide is the human one.
// setError shows Russian in the guide and keeps the raw line in #report.
function setError(ru: string): void {
  lastError = ru;
}
function clearError(): void {
  lastError = null;
}

// ---- Guide projection (pure state -> panel) --------------------------------

function snapshot(): GuideSnapshot {
  return {
    cameraOn,
    calibrationStep,
    hasRefs: refs !== null,
    redOrangeOk: refs === null ? true : redOrangeGate(refs).ok,
    scrambleSet: expectedFacelets !== null,
    scrambleVerified,
    gateMode,
    collector: collector
      ? { purpose: collector.purpose, facesLength: collector.faces.length }
      : null,
    fsmState: fsm.state,
    solveElapsedMs,
    lastError,
  };
}

let lastGuideKey = "";

function renderGuide(state: GuideState): void {
  els.guideTitle.textContent = state.titleRu;
  els.guideNow.textContent = state.nowRu;
  els.guideNow.className = state.step === "error" ? "guide-status-bad" : "";
  els.guideNext.textContent = state.nextRu;
  els.guideProgress.textContent = state.progress ?? "";
  for (const b of guideButtons) {
    const isNext = b.id === state.activeButtonId;
    b.classList.toggle("guide-next", isNext && !b.disabled);
    b.classList.toggle("guide-dim", !isNext && b.id !== "btn-start");
  }
  // Reset warning is only meaningful while a 6-face collection is in flight.
  els.resetNote.hidden = collector === null;
}

// Recompute + render the guide. Called at the end of every button handler and,
// debounced, at the tail of onFrame.
function refreshGuide(): void {
  renderGuide(guideStateFor(snapshot()));
}

els.btnStart.addEventListener("click", async () => {
  els.btnStart.disabled = true;
  els.btnStart.textContent = "Starting…";
  try {
    await hands.init();
    hands.setZones(zones);
    await camera.start(onFrame);
    cameraOn = true;
    clearError();
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
      setError(modelFailedRu());
    } else {
      const err = e as CameraError;
      log(`Camera error (${err.kind ?? "unknown"}): ${err.message}`);
      setError(cameraDeniedRu());
    }
  }
  refreshGuide();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="gate-mode"]')) {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      gateMode = radio.value as GateMode;
      refreshGuide();
    }
  });
}

els.btnCalibrate.addEventListener("click", () => {
  if (calibrationStep >= COLOR_NAMES.length) {
    // Allow a full re-calibration from scratch (e.g. after a bad-light gate).
    calibrationStep = 0;
    refs = null;
  }
  // Recalibration invalidates any in-flight 6-face collection / verify state.
  collector = null;
  scrambleVerified = false;
  clearError();
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
    if (!gate.ok) setError(lightBadRu(gate.de, config.MIN_RED_ORANGE_DE));
  }
  refreshGuide();
});

const calibrationRefsRgb: Partial<Record<ColorName, RGB>> = {};

els.btnScramble.addEventListener("click", () => {
  // New scramble also RESETS the whole mini-cycle so it is repeatable without a
  // page reload: fresh FSM, cleared timer, dropped in-flight 6-face collection.
  resetCycle();
  clearError();
  currentScramble = randomScramble();
  expectedFacelets = scrambleToFacelets(currentScramble);
  const v = validateFacelets(expectedFacelets);
  log(
    `Scramble: ${currentScramble}\n` +
      `Expected state valid: ${v.ok}${v.reason ? " (" + v.reason + ")" : ""}\n` +
      `Apply it, then "Verify scramble (read 6)" BEFORE solving.`,
  );
  refreshGuide();
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
  clearError();
  els.timer.textContent = "0.000";
  els.fsmState.textContent = fsm.state;
}

els.btnRead.addEventListener("click", () => {
  if (!ensureReadable()) return void refreshGuide();
  clearError();
  const face = readFace(video, video.videoWidth, video.videoHeight, work);
  // Single-face independent read (quota needs all 54 — used in accuracy gate).
  const names = face.lab.map((lab) => argminRef(lab, refs!));
  log(`Read (center=${names[4]}): ${names.join(" ")}`);
  refreshGuide();
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

type PushFailKind = "unreadable" | "assign" | "ambiguous" | "resolve";

// Push one captured face; returns the assembled read facelets when 6 are in.
// On the final capture, also returns the pipeline intermediates (raw per-sticker
// classification aligned to URFDLB, plus the resolved facelets) so the accuracy
// gate can score RAW-vs-RESOLVED without re-running the pipeline.
function pushFace():
  | { read: Facelet; rawRead: Facelet }
  | { pending: true }
  | { failed: string; kind: PushFailKind } {
  if (!ensureReadable()) return { failed: "not readable (see report)", kind: "unreadable" };
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
    return { failed: `face assignment failed: ${assign.reason}`, kind: "assign" };
  }
  // Per-sticker classify each face to letters (argmin over refs), then resolve.
  const faceGrids: Face[][] = collector!.faces.map((grid) =>
    grid.map((lab) => argminRef(lab, refs!) as string as Face),
  );
  const res = resolveRotations(faceGrids, assign.faces);
  if (!res.ok) {
    const kind: PushFailKind = res.reason?.includes("ambiguous") ? "ambiguous" : "resolve";
    return { failed: `rotation resolve failed: ${res.reason}`, kind };
  }
  // Assemble the RAW classification in the SAME URFDLB slot order and with the
  // SAME per-capture rotation the resolver used, so rawRead[i] and the resolved
  // facelets[i] refer to the identical physical sticker (Mode A ground truth).
  const slotOf: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const rawSlots: (Face[] | null)[] = new Array(6).fill(null);
  for (let capture = 0; capture < 6; capture++) {
    rawSlots[slotOf[assign.faces[capture]]] = rotateGrid(faceGrids[capture], res.rotations![capture]);
  }
  const rawRead = rawSlots.map((g) => (g as Face[]).join("")).join("");
  return { read: res.facelets!, rawRead };
}

els.btnVerify.addEventListener("click", () => {
  if (!refs) return void log("Calibrate all 6 faces first.");
  if (!expectedFacelets) return void log("Generate a scramble first (New scramble).");
  if (!collector || collector.purpose !== "verify") {
    clearError();
    beginCollection("verify", expectedFacelets);
    return void refreshGuide();
  }
  if (collector.expected !== expectedFacelets) {
    collector = null;
    log("Scramble changed mid-collection — verify aborted. Start over.");
    return void refreshGuide();
  }
  const r = pushFace();
  if ("pending" in r) return void refreshGuide();
  if ("failed" in r) {
    collector = null;
    appendLog(`\nVERIFY FAILED (FAIL LOUD): ${r.failed}. Re-capture.`);
    setError(pushFailRu(r.kind));
    return void refreshGuide();
  }
  collector = null;
  const read = r.read;
  const v = validateFacelets(read);
  if (!v.ok) {
    appendLog(`\nRead is not a legal cube: ${v.reason}. Re-capture.`);
    setError(rotationFailedRu());
    return void refreshGuide();
  }
  const diffs = diffFacelets(read, expectedFacelets!);
  if (diffs.length === 0) {
    scrambleVerified = true;
    clearError();
    appendLog("\nSCRAMBLE VERIFIED: read matches expected. Put hands in zones to arm the timer.");
  } else {
    scrambleVerified = false;
    const d = diffs[0];
    appendLog(
      `\nSCRAMBLE MISMATCH: ${diffs.length} stickers differ. ` +
        `First: face ${d.face}[${d.cellInFace}] (idx ${d.globalIndex}) read ${d.read} expected ${d.expected}. ` +
        `Fix the cube / re-scramble before solving.`,
    );
    setError(verifyMismatchRu(d.face, diffs.length));
  }
  refreshGuide();
});

els.btnConfirm.addEventListener("click", () => {
  if (!refs) return void log("Calibrate all 6 faces first.");
  if (!collector || collector.purpose !== "confirm") {
    clearError();
    beginCollection("confirm", SOLVED);
    return void refreshGuide();
  }
  const r = pushFace();
  if ("pending" in r) return void refreshGuide();
  if ("failed" in r) {
    collector = null;
    appendLog(`\nCONFIRM FAILED (FAIL LOUD): ${r.failed}. Re-capture.`);
    setError(pushFailRu(r.kind));
    return void refreshGuide();
  }
  collector = null;
  const read = r.read;
  const diffs = diffFacelets(read, SOLVED);
  if (diffs.length === 0) {
    clearError();
    appendLog("\nSOLVED CONFIRMED: read == SOLVED. Cycle complete. New scramble to go again.");
  } else {
    const d = diffs[0];
    appendLog(
      `\nNOT SOLVED: ${diffs.length} stickers off. ` +
        `First: face ${d.face}[${d.cellInFace}] (idx ${d.globalIndex}) read ${d.read} expected ${d.expected}.`,
    );
  }
  refreshGuide();
});

// Accuracy gate — novice-runnable, no notation (plan "Key design change").
//   Mode A (handmix): ground truth = the legality-RESOLVED state the pipeline
//     recovers from the 6 hand-mixed faces; score the RAW argmin classification
//     against it. Measures the classifier on a genuinely mixed cube.
//   Mode B (solved): ground truth = SOLVED; the resolved read must itself equal
//     SOLVED (else "покажи собранный кубик заново"), then score RAW vs SOLVED.
els.btnAccuracy.addEventListener("click", () => {
  if (!refs) return void log("Calibrate first.");
  if (!collector || collector.purpose !== "accuracy") {
    clearError();
    beginCollection("accuracy", null);
    return void refreshGuide();
  }
  const r = pushFace();
  if ("pending" in r) return void refreshGuide();
  if ("failed" in r) {
    collector = null;
    appendLog(`\nACCURACY GATE: read failed (${r.failed}). Re-show 6 faces.`);
    setError(pushFailRu(r.kind));
    return void refreshGuide();
  }
  collector = null;

  if (gateMode === "solved") {
    // Guard: in solved mode the resolved state must actually BE solved, else the
    // user showed a mixed cube — do not score against the wrong ground truth.
    if (r.read !== SOLVED) {
      appendLog("\nACCURACY GATE (solved mode): cube is not solved — show a SOLVED cube.");
      setError("Это режим собранного кубика, а кубик перемешан. Собери его и покажи заново.");
      return void refreshGuide();
    }
    const rep = gateSolved(r.rawRead);
    if (!rep) return void refreshGuide();
    appendLog("\n[Mode B / solved] " + formatReport(rep));
    showAccuracy(rep.correct, rep.fraction, rep.pass);
    return;
  }

  // Mode A: score raw classification against the resolved legal state.
  const rep = gateHandMix(r.rawRead, r.read);
  if (!rep) {
    appendLog("\nACCURACY GATE: could not build a legal ground truth — re-show 6 faces / change light.");
    setError(rotationAmbiguousRu());
    return void refreshGuide();
  }
  appendLog("\n[Mode A / hand-mix] " + formatReport(rep));
  const diffs = diffFacelets(r.rawRead, r.read);
  if (diffs.length) {
    const d = diffs[0];
    appendLog(`\nFirst raw-vs-resolved mismatch: ${d.face}[${d.cellInFace}] read ${COLOR_LABELS_RU[d.read] ?? d.read} эталон ${COLOR_LABELS_RU[d.expected] ?? d.expected}`);
  }
  showAccuracy(rep.correct, rep.fraction, rep.pass);
});

// Present the accuracy result in the guide panel (a terminal step — not one of
// the guideStateFor steps, so it is written directly rather than via refreshGuide).
function showAccuracy(correct: number, fraction: number, pass: boolean): void {
  clearError();
  els.guideTitle.textContent = "Точность посчитана";
  els.guideNow.textContent =
    `Классификатор угадал ${correct}/54 наклеек (${(fraction * 100).toFixed(1)}%) — ` +
    `${pass ? "✓ порог пройден" : "✗ ниже порога"}. Подробности в отчёте ниже.`;
  els.guideNow.className = pass ? "guide-status-ok" : "guide-status-bad";
  els.guideNext.textContent = "Ещё раз — перемешай руками и снова «Проверка точности».";
  els.guideProgress.textContent = "";
  for (const b of guideButtons) {
    b.classList.toggle("guide-next", b.id === "btn-accuracy" && !b.disabled);
    b.classList.toggle("guide-dim", b.id !== "btn-accuracy" && b.id !== "btn-start");
  }
}

function pushFailRu(kind: PushFailKind): string {
  switch (kind) {
    case "unreadable":
      return lastError ?? faceUnreadableRu(); // ensureReadable already set light/luma copy
    case "assign":
      return faceUnreadableRu();
    case "ambiguous":
      return rotationAmbiguousRu();
    case "resolve":
      return rotationFailedRu();
  }
}

// Shared gate for any read: refs present, red/orange ΔE ok, frame luma in range.
function ensureReadable(): boolean {
  if (!refs) {
    log("Calibrate all 6 faces first.");
    return false;
  }
  const gate = redOrangeGate(refs);
  if (!gate.ok) {
    log(`Refs too close (min ΔE ${gate.de.toFixed(1)} < ${config.MIN_RED_ORANGE_DE}) — change light and re-calibrate before reading.`);
    setError(lightBadRu(gate.de, config.MIN_RED_ORANGE_DE));
    return false;
  }
  const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
  if (luma < config.MIN_FRAME_LUMA || luma > config.MAX_FRAME_LUMA) {
    log(`Frame luma ${luma.toFixed(0)} outside [${config.MIN_FRAME_LUMA}, ${config.MAX_FRAME_LUMA}] — change light before reading.`);
    setError(lumaBadRu(luma, config.MIN_FRAME_LUMA, config.MAX_FRAME_LUMA));
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
      clearError();
    } else {
      // Guard: never time a solve whose scramble was not verified vs cubejs.
      appendLog("Timer NOT started: verify the scramble (read 6) first.");
      setError(timerBlockedRu());
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
    setError(dnfRu());
  }
  if (solveStartTs !== null) solveElapsedMs = nowTs - solveStartTs;

  els.fsmState.textContent = res.state;
  els.timer.textContent = (solveElapsedMs / 1000).toFixed(3);

  drawOverlay(octx, width, height, obs, zones, config.GUIDE_RECT, {
    guide: "Держи кубик здесь",
    left: "Левая рука",
    right: "Правая рука",
  });

  // Re-render the guide only when the step or FSM state changes (not 60×/s).
  const key = `${res.state}|${res.event ?? ""}|${lastError ?? ""}|${scrambleVerified}`;
  if (key !== lastGuideKey) {
    lastGuideKey = key;
    refreshGuide();
  }
}

// Initial render: show step 1 before the camera starts.
refreshGuide();
