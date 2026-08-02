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

/**
 * Resolve a guide Rect (frame fractions) to a CENTERED PIXEL-SQUARE region of a
 * `w`x`h` frame. Side = min(guide.w*w, guide.h*h), centered inside the guide rect.
 * The 3x3 face sampler assumes a SQUARE cube fills the region; a wider-than-tall
 * region (equal fractions on a landscape frame, or a deliberately wide rect) makes
 * the left/right sticker columns sample the background instead of the cube — which
 * read a solved cube ~70% wrong at verify while calibration (center cell only)
 * always worked. Both the sampler (readFace/guideRegionLuma) and the overlay use
 * this, so the drawn yellow box is EXACTLY the region that gets read.
 */
export function squareGuidePx(
  guide: Rect,
  w: number,
  h: number,
): { gx: number; gy: number; gw: number; gh: number } {
  const rw = guide.w * w;
  const rh = guide.h * h;
  const side = Math.min(rw, rh);
  return {
    gx: Math.round(guide.x * w + (rw - side) / 2),
    gy: Math.round(guide.y * h + (rh - side) / 2),
    gw: Math.round(side),
    gh: Math.round(side),
  };
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
  // Отбраковка бликов/теней внутри ячейки (см. colors.robustCellColor).
  CELL_LUMA_TOLERANCE: number; // коридор яркости вокруг медианы ячейки
  CELL_BLOWN_LUMA: number; // выше этой яркости пиксель считается выбитым в пересвет
  CELL_MIN_KEPT_FRAC: number; // если выжило меньше — цвет ячейки ненадёжен
  // Порог уверенности классификации наклейки (см. hooks/useCubeReader).
  STICKER_MARGIN_MIN: number; // минимальный отрыв ΔE второго кандидата от первого
  STICKER_MAX_DELTA_E: number; // дальше этого от эталона — чтение не считается уверенным
  FACE_MIN_CONFIDENT_CELLS: number; // сколько из 9 ячеек должны быть уверенными
  // «В рамке вообще не грань кубика»: медиана ΔE до БЛИЖАЙШЕГО эталона по девяти
  // ячейкам, посчитанная по СЫРЫМ цветам. Отдельный замок от порога уверенности:
  // тот меряет, различимы ли цвета между собой, а этот — принадлежат ли они кубику.
  // Живой отказ (LED, монолитный кубик): вместо зелёной грани в рамку попал стол,
  // все девять ячеек серые, медиана 20.6 при 4.2 по здоровому чтению — и ни одна
  // проверка не возразила.
  FACE_MAX_MEDIAN_DE: number;
  // Подгонка сетки под грань (см. vision/faceFit): насколько подогнанная сетка
  // должна быть лучше рамочной, чтобы ей поверили. Ноль означал бы дёрганье
  // сетки от кадра к кадру на шуме.
  FACE_FIT_MIN_GAIN: number;
  // Структурный признак грани: между наклейками есть тёмные щели, и они лежат на
  // границах ячеек (1/3 и 2/3 стороны). Без него оценка «каждая ячейка похожа на
  // какой-нибудь эталон» пропускает ровный светлый фон — он похож на белый
  // эталон, и сетка спокойно съезжает со кубика на стол/стену.
  FACE_FIT_GAP_TARGET: number; // насколько щели должны быть темнее наклеек (яркость 0..255)
  FACE_FIT_GAP_WEIGHT: number; // вес недобора контраста в стоимости кандидата
  FACE_FIT_GAP_BAND_FRAC: number; // толщина полосы вокруг границы ячеек, в долях ячейки
  // Замки на негодную калибровку (см. colors.checkCalibration). Белая наклейка —
  // самая светлая из шести при любом свете; если снятый «белый» темнее, в кадре
  // была не грань (рука, стол). Slack — запас на шум: на живом прогоне белый
  // опережал жёлтую всего на единицу.
  CALIB_WHITE_LIGHTNESS_SLACK: number;
  // Порог полного слипания эталонов. Низкий намеренно: на живой вебкамере
  // красный с оранжевым расходятся на 16–17, блок по 20 запретил бы калибровку,
  // на которой сырое чтение давало 65%.
  CALIB_MIN_SEPARATION_DE: number;
  // Съёмка грани: сколько кадров подряд усредняем медианой. Один кадр ловит
  // смаз, случайный блик и полукадр от rolling shutter; медиана по нескольким
  // это снимает и стоит ~100 мс, которых человек не замечает.
  CAPTURE_FRAMES: number;
  CAPTURE_FRAME_GAP_MS: number;
  // Сколько раз подряд можно отклонить грань по неуверенности, прежде чем
  // принять её с предупреждением. Без этого человек запирается: камера честно
  // говорит «не уверена», а сделать с этим ему нечего.
  FACE_CONFIDENCE_RETRIES: number;

  // ---- Color classification -------------------------------------------------
  QUOTA: number; // stickers per color on a 3x3x3 cube (always 9)
  DELTA_E_MODE: DeltaEMode; // CIEDE2000 by default; CIE76 is the documented fallback

  // ---- Sanity gates (before reading) ----------------------------------------
  MIN_RED_ORANGE_DE: number; // if calibrated red/orange refs are closer than this -> bad light
  MIN_FRAME_LUMA: number; // mean frame luma (0..255) must be within [min,max]
  MAX_FRAME_LUMA: number;
  CENTER_DRIFT_DE: number; // per-face: face center drift from calibration beyond this -> reprompt

  // ---- Quick-adjust (one-white-face session white-balance) ------------------
  // Distinct named thresholds — NOT overloaded onto MIN_RED_ORANGE_DE. A seeded
  // profile is nudged by a single WHITE face (von-Kries gain). These gate the
  // decision on the OBSERVED face (skeptic HIGH#1/#3), never on the shifted refs.
  QUICK_ADJUST_MATCH_DE: number; // max ΔE of the shown face's median to the white (U) ref; over → wrong face/cube
  QUICK_ADJUST_CLUSTER_DE: number; // max intra-cluster ΔE spread of the 9 stickers; over → loose read, recalibrate
  QUICK_ADJUST_MARGIN_DE: number; // min (2nd-best − nearest) ΔE margin; under → not a confident white match

  // ---- Accuracy gate --------------------------------------------------------
  ACCURACY_PASS_FRAC: number; // fraction of the 54 stickers that must be correct (0.90)

  // ---- Casual-solo verify tolerance -----------------------------------------
  // Solo is casual (validated:false). The strict verify demands a globally-LEGAL
  // 54-sticker read (a single colour misread → whole read rejected → R1 pain).
  // For casual solo we instead score the real read against the expected facelets
  // per-face (best rotation) and accept if at least this FRACTION of the 54
  // stickers match — one misread no longer nukes the read. Ranked (Stage 4) keeps
  // the strict legal-cube path. HMR-tunable: lower it if a demo still trips.
  CASUAL_VERIFY_MIN_CORRECT_FRAC: number;

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

  // Large, roughly PIXEL-SQUARE on a 16:9 frame so all 9 sticker cells land on the
  // cube (squareGuidePx enforces the exact centered square). On 1280x720: w*W≈384,
  // h*H≈396 → ~384px square. Centered horizontally; vertical band covers chest
  // height. Was previously {w:0.36,h:0.20} — a 3.2:1 strip whose side columns read
  // the background, so a solved cube verified ~70% wrong.
  GUIDE_RECT: { x: 0.35, y: 0.24, w: 0.3, h: 0.55 },
  CELL_CENTER_FRAC: 0.5,
  CELL_LUMA_TOLERANCE: 34,
  CELL_BLOWN_LUMA: 246,
  CELL_MIN_KEPT_FRAC: 0.25,
  STICKER_MARGIN_MIN: 4,
  STICKER_MAX_DELTA_E: 34,
  // Между здоровой гранью (медиана ~4 на живом прогоне) и фоном (20.6) огромная
  // щель; 16 стоит в ней с запасом в обе стороны. Выше 20 замок пропустил бы
  // ровно тот отказ, ради которого написан, ниже 12 — рисковал бы честной гранью
  // на подсаженном профиле, где свет ушёл, а нормировка ещё не применена.
  FACE_MAX_MEDIAN_DE: 16,
  FACE_MIN_CONFIDENT_CELLS: 8,
  FACE_FIT_MIN_GAIN: 1.5,
  FACE_FIT_GAP_TARGET: 12,
  FACE_FIT_GAP_WEIGHT: 1.0,
  FACE_FIT_GAP_BAND_FRAC: 0.12,
  CALIB_WHITE_LIGHTNESS_SLACK: 3,
  CALIB_MIN_SEPARATION_DE: 10,
  CAPTURE_FRAMES: 5,
  CAPTURE_FRAME_GAP_MS: 22,
  FACE_CONFIDENCE_RETRIES: 2,

  QUOTA: 9,
  DELTA_E_MODE: "ciede2000",

  MIN_RED_ORANGE_DE: 8,
  MIN_FRAME_LUMA: 40,
  MAX_FRAME_LUMA: 230,
  CENTER_DRIFT_DE: 12,

  QUICK_ADJUST_MATCH_DE: 25,
  QUICK_ADJUST_CLUSTER_DE: 12,
  QUICK_ADJUST_MARGIN_DE: 10,

  ACCURACY_PASS_FRAC: 0.9,

  CASUAL_VERIFY_MIN_CORRECT_FRAC: 0.7,

  CAMERA_FRAMERATE_IDEAL: 60,
};
