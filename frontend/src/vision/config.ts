// Single source of truth for every tunable threshold in the vision pipeline.
// HMR-friendly: edit a number, save, re-tune live. Keep ALL magic numbers here.
//
// This module is DOM-free and import-safe under the Vitest node env. If a future
// tunable needs window/document, guard it with `typeof window !== "undefined"`.

export type DeltaEMode = "ciede2000" | "cie76";

export interface Rect {
  // Fractions of the video frame (0..1), so geometry is resolution-independent.
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Config {
  // ---- Hands FSM timing (milliseconds) --------------------------------------
  ZONE_ENTER_MS: number; // both hands inside zones this long -> HANDS_IN_ZONE
  STILL_MS: number; // motion below threshold this long -> READY
  STOP_MS: number; // both hands back in zones this long -> STOPPED
  LEAVE_DEBOUNCE_MS: number; // a hand must be OUT of its zone this long to count as "left"
  ABORT_MS: number; // detection lost this long in READY/SOLVING -> ABORT/reset

  // ---- Stillness metric -----------------------------------------------------
  // Motion is measured in MediaPipe normalized coords (0..1) and then divided by
  // hand size (landmark 0<->9 distance) => scale-invariant. Threshold is a
  // FRACTION of hand size, not raw pixels.
  STILL_MOTION_FRAC: number;

  // ---- Start rule -----------------------------------------------------------
  // "first" = timer starts when the FIRST hand leaves its zone.
  // "both"  = timer starts only after BOTH hands have left.
  START_RULE: "first" | "both";

  // ---- Guide frame / cell sampling ------------------------------------------
  GUIDE_RECT: Rect; // where the cube face should sit in the frame
  CELL_CENTER_FRAC: number; // central region of each cell sampled for color (0.5 = central 50%)

  // ---- Color classification -------------------------------------------------
  QUOTA: number; // stickers per color on a 3x3x3 cube (always 9)
  DELTA_E_MODE: DeltaEMode; // CIEDE2000 by default; CIE76 is the documented fallback

  // ---- Sanity gates (before reading) ----------------------------------------
  MIN_RED_ORANGE_DE: number; // if calibrated red/orange refs are closer than this -> bad light
  MIN_FRAME_LUMA: number; // mean frame luma (0..255) must be within [min,max]
  MAX_FRAME_LUMA: number;
  CENTER_DRIFT_DE: number; // per-face: face center drift from calibration beyond this -> reprompt

  // ---- Accuracy gate --------------------------------------------------------
  ACCURACY_PASS_FRAC: number; // fraction of the 54 stickers that must be correct (0.90)

  // ---- Camera ---------------------------------------------------------------
  CAMERA_FRAMERATE_IDEAL: number;
}

export const config: Config = {
  ZONE_ENTER_MS: 200,
  STILL_MS: 500,
  STOP_MS: 200,
  LEAVE_DEBOUNCE_MS: 120,
  ABORT_MS: 800,

  STILL_MOTION_FRAC: 0.03,

  START_RULE: "first",

  GUIDE_RECT: { x: 0.34, y: 0.22, w: 0.32, h: 0.32 },
  CELL_CENTER_FRAC: 0.5,

  QUOTA: 9,
  DELTA_E_MODE: "ciede2000",

  MIN_RED_ORANGE_DE: 8,
  MIN_FRAME_LUMA: 40,
  MAX_FRAME_LUMA: 230,
  CENTER_DRIFT_DE: 12,

  ACCURACY_PASS_FRAC: 0.9,

  CAMERA_FRAMERATE_IDEAL: 60,
};
