// Accuracy RUN accumulator — the cross-read state accuracy.ts deliberately lacks.
//
// accuracy.ts scores ONE read (54 stickers) and builds a per-color confusion
// matrix. This module is the honest-measurement layer on top: it assembles a raw
// per-sticker read from fixed-order captured face grids, accumulates many reads
// PER CONDITION (mode × light × cube × person × calibration), and decides the Stage-0.3
// gate as MIN-over-conditions of a Wilson lower bound — NOT a pooled mean, which
// would let a good condition mask a failing one.
//
// Anti-survivorship (skeptic HIGH#1): we score the RAW argmin read assembled
// straight from the fixed capture order — never the legality-resolved read (which
// silently repairs the worst red/orange misreads). Dropped/illegal/unreadable
// reads are COUNTED in the denominator (drop-rate is gated), never discarded.
//
// Pure & DOM-free: node-testable. No React, no canvas.

import { type AccuracyReport } from "./accuracy";
import { config } from "./config";
import { FACE_ORDER, type Face, type Facelet } from "./cubeState";

// --- Protocol constants ------------------------------------------------------

/** Fixed capture order the tester follows (белый верх, зелёный к себе): URFDLB. */
export const CAPTURE_ORDER = FACE_ORDER;

/** Wilson two-sided z for a 95% interval. */
export const WILSON_Z = 1.96;

/** Minimum scored reads before a condition may return a verdict (significance). */
export const MIN_READS = 20;

/** A condition fails if more than this fraction of its reads were dropped. */
export const MAX_DROP_RATE = 0.15;

// Standard scheme under "white top, green front": which face-letter is which
// physical color. Drives the hotspot pairs the gate reports explicitly.
//   U=white R=red F=green D=yellow L=orange B=blue
export const HOTSPOT_PAIRS = {
  /** white ↔ yellow */
  whiteYellow: ["U", "D"] as const,
  /** red ↔ orange (the R1 risk) */
  redOrange: ["R", "L"] as const,
} as const;

// --- Types -------------------------------------------------------------------

export type DropReason =
  | "unreadable" // luma/refs gate failed
  | "drift" // a captured face center drifted from calibration
  | "illegal" // assembled read is not a legal cube
  | "ambiguous" // rotation resolve was ambiguous
  | "resolve" // rotation resolve failed
  | "mis-scramble" // tester applied the wrong scramble (manual exclusion)
  // Кубик показан в другой ориентации: чтение совпадает с эталоном с точностью
  // до поворота, значит цвета прочитаны верно, а фиксированное выравнивание
  // протокола нарушено. Считать такое чтение по совпавшей ориентации нельзя —
  // выравнивание, подобранное под ответ, и есть survivorship bias, ради запрета
  // которого порядок захвата зафиксирован.
  | "orientation";

export const DROP_REASONS: readonly DropReason[] = [
  "unreadable",
  "drift",
  "illegal",
  "ambiguous",
  "resolve",
  "mis-scramble",
  "orientation",
];

export interface ConditionKey {
  /**
   * Эталон, против которого считалась точность: "solved" (собранный) или
   * "scramble" (известный скрамбл).
   *
   * Это ОСЬ УСЛОВИЯ, а не пометка. На собранном кубике грань однотонная: рядом
   * нет ни красного с оранжевым, ни белого с жёлтым, и промах сетки на соседнюю
   * наклейку того же цвета вообще не виден. Двадцать чистых санити-чтений не
   * говорят ничего о перемешанном кубике — а гейт 0.3 нужен именно для него.
   * Пока режим не входил в ключ, такие чтения сливались в одно число, и санити
   * молча вытягивал средний результат.
   */
  mode: string;
  light: string; // e.g. "день", "тёплый ЛН", "холодный LED"
  cube: string; // e.g. "стикерный", "stickerless"
  person: string; // tester id/name
  calib: string; // calibration provenance, e.g. "fresh", "drift-checked"
}

export interface ConditionAcc {
  key: ConditionKey;
  confusion: Record<Face, Record<Face, number>>;
  correct: number; // stickers correct across all scored reads
  total: number; // stickers scored (== nScored * 54)
  nScored: number; // reads scored
  nDropped: number; // reads dropped (counted in denominator)
  dropReasons: Record<string, number>;
}

export type AccuracyRun = Map<string, ConditionAcc>;

export interface ConditionVerdict {
  key: ConditionKey;
  fraction: number; // point estimate correct/total
  wilsonLower: number; // Wilson lower bound
  nScored: number;
  nDropped: number;
  dropRate: number;
  enoughReads: boolean;
  pass: boolean; // wilsonLower ≥ passFrac AND enoughReads AND dropRate ≤ MAX
}

export interface GateResult {
  pass: boolean;
  conditions: ConditionVerdict[];
  min: ConditionVerdict | null; // worst-condition verdict (drives the gate)
  passFrac: number;
}

export interface HotspotCount {
  label: string;
  a: Face;
  b: Face;
  aToB: number; // expected a, read b
  bToA: number; // expected b, read a
  total: number; // aToB + bToA
  n: number; // stickers whose expected color was a or b (the exposure)
}

// --- Assembly ----------------------------------------------------------------

/**
 * Assemble a 54-char URFDLB raw read from 6 captured face grids in the FIXED
 * capture order. No rotation recovery, no legality resolve — the protocol fixes
 * both order and in-plane orientation, so grid cell k of capture i lands at its
 * known slot. Throws on malformed input (must be 6 faces × 9 cells).
 */
export function assembleRawRead(rawFaceGrids: Face[][]): Facelet {
  if (rawFaceGrids.length !== 6) {
    throw new Error(`assembleRawRead: expected 6 faces, got ${rawFaceGrids.length}`);
  }
  let out = "";
  for (let f = 0; f < 6; f++) {
    const grid = rawFaceGrids[f];
    if (grid.length !== 9) {
      throw new Error(`assembleRawRead: face ${f} has ${grid.length} cells, expected 9`);
    }
    out += grid.join("");
  }
  return out;
}

/**
 * Похоже ли чтение на СОБРАННЫЙ кубик: каждая из шести граней прочитана одним
 * цветом.
 *
 * Нужно, чтобы поймать самую дорогую ошибку тестировщика — снять кубик, не
 * собрав на нём скрамбл. Эталон тогда скрамблированный, чтение собранное, и
 * совпадений выходит около случайных 28%. Ни одна проверка цвета такое не
 * заметит: цвета-то прочитаны верно, врёт не зрение, а условие замера. Занести
 * такое в точность — значит записать зрению чужую ошибку.
 *
 * Порог намеренно жёсткий (ВСЕ шесть граней одноцветны): у настоящего скрамбла
 * шансов выглядеть так нет, а у сбойного чтения — тем более, так что ложных
 * срабатываний ждать неоткуда.
 */
export function looksSolvedRead(faceGrids: Face[][]): boolean {
  if (faceGrids.length !== 6) return false;
  return faceGrids.every((grid) => grid.length === 9 && grid.every((c) => c === grid[0]));
}

// --- Accumulator -------------------------------------------------------------

export function condKeyString(k: ConditionKey): string {
  return `${k.mode}|${k.light}|${k.cube}|${k.person}|${k.calib}`;
}

function emptyConfusion(): Record<Face, Record<Face, number>> {
  const m = {} as Record<Face, Record<Face, number>>;
  for (const a of FACE_ORDER) {
    m[a] = {} as Record<Face, number>;
    for (const b of FACE_ORDER) m[a][b] = 0;
  }
  return m;
}

function ensureCondition(run: AccuracyRun, key: ConditionKey): ConditionAcc {
  const id = condKeyString(key);
  let acc = run.get(id);
  if (!acc) {
    acc = {
      key,
      confusion: emptyConfusion(),
      correct: 0,
      total: 0,
      nScored: 0,
      nDropped: 0,
      dropReasons: {},
    };
    run.set(id, acc);
  }
  return acc;
}

/** Merge one scored read (from scoreRead) into its condition bucket. */
export function appendRead(run: AccuracyRun, key: ConditionKey, report: AccuracyReport): void {
  const acc = ensureCondition(run, key);
  acc.correct += report.correct;
  acc.total += report.total;
  acc.nScored += 1;
  for (const e of FACE_ORDER) {
    for (const r of FACE_ORDER) acc.confusion[e][r] += report.confusion[e][r];
  }
}

/** Record a dropped read (counted in the denominator, never scored). */
export function appendDrop(run: AccuracyRun, key: ConditionKey, reason: DropReason): void {
  const acc = ensureCondition(run, key);
  acc.nDropped += 1;
  acc.dropReasons[reason] = (acc.dropReasons[reason] ?? 0) + 1;
}

/**
 * Reverse a previously appended read (tester realises it was a mis-scramble /
 * bad capture). Subtracts the exact `report` that was merged, so the condition
 * doesn't lose its other reads. Optionally books the exclusion as a drop so it
 * shows in the histogram. No-op if the condition/bucket is empty.
 */
export function undoRead(
  run: AccuracyRun,
  key: ConditionKey,
  report: AccuracyReport,
  reason: DropReason | null = null,
): void {
  const acc = run.get(condKeyString(key));
  if (!acc || acc.nScored === 0) return;
  acc.correct -= report.correct;
  acc.total -= report.total;
  acc.nScored -= 1;
  for (const e of FACE_ORDER) {
    for (const r of FACE_ORDER) acc.confusion[e][r] -= report.confusion[e][r];
  }
  if (reason) {
    acc.nDropped += 1;
    acc.dropReasons[reason] = (acc.dropReasons[reason] ?? 0) + 1;
  }
}

// --- Verdicts ----------------------------------------------------------------

/** Wilson score-interval lower bound for `successes` of `n`. Returns 0 when n=0. */
export function wilsonLowerBound(successes: number, n: number, z: number = WILSON_Z): number {
  if (n <= 0) return 0;
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return (center - margin) / denom;
}

export function conditionVerdict(
  acc: ConditionAcc,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): ConditionVerdict {
  const fraction = acc.total > 0 ? acc.correct / acc.total : 0;
  const wilsonLower = wilsonLowerBound(acc.correct, acc.total);
  const denom = acc.nScored + acc.nDropped;
  const dropRate = denom > 0 ? acc.nDropped / denom : 0;
  const enoughReads = acc.nScored >= MIN_READS;
  const pass = wilsonLower >= passFrac && enoughReads && dropRate <= MAX_DROP_RATE;
  return {
    key: acc.key,
    fraction,
    wilsonLower,
    nScored: acc.nScored,
    nDropped: acc.nDropped,
    dropRate,
    enoughReads,
    pass,
  };
}

/**
 * Gate = MIN over conditions. PASS iff the run has at least one condition and
 * EVERY condition passes. A pooled mean would let a strong condition mask a
 * failing one — forbidden.
 */
export function gatePass(
  run: AccuracyRun,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): GateResult {
  const conditions = [...run.values()].map((acc) => conditionVerdict(acc, passFrac));
  let min: ConditionVerdict | null = null;
  for (const c of conditions) {
    if (min === null || c.wilsonLower < min.wilsonLower) min = c;
  }
  const pass = conditions.length > 0 && conditions.every((c) => c.pass);
  return { pass, conditions, min, passFrac };
}

// --- Hotspots ----------------------------------------------------------------

function hotspot(acc: ConditionAcc, label: string, a: Face, b: Face): HotspotCount {
  const aToB = acc.confusion[a][b];
  const bToA = acc.confusion[b][a];
  let n = 0;
  for (const r of FACE_ORDER) n += acc.confusion[a][r] + acc.confusion[b][r];
  return { label, a, b, aToB, bToA, total: aToB + bToA, n };
}

/** The two adjacency-risk confusion pairs with their exposure N. */
export function hotspots(acc: ConditionAcc): {
  redOrange: HotspotCount;
  whiteYellow: HotspotCount;
} {
  const [ro0, ro1] = HOTSPOT_PAIRS.redOrange;
  const [wy0, wy1] = HOTSPOT_PAIRS.whiteYellow;
  return {
    redOrange: hotspot(acc, "red↔orange", ro0, ro1),
    whiteYellow: hotspot(acc, "white↔yellow", wy0, wy1),
  };
}

/** Sum a run's hotspots across all conditions (for the top-line summary). */
export function runHotspots(run: AccuracyRun): {
  redOrange: HotspotCount;
  whiteYellow: HotspotCount;
} {
  const [ro0, ro1] = HOTSPOT_PAIRS.redOrange;
  const [wy0, wy1] = HOTSPOT_PAIRS.whiteYellow;
  const merged: ConditionAcc = {
    key: { mode: "", light: "", cube: "", person: "", calib: "" },
    confusion: emptyConfusion(),
    correct: 0,
    total: 0,
    nScored: 0,
    nDropped: 0,
    dropReasons: {},
  };
  for (const acc of run.values()) {
    for (const e of FACE_ORDER) {
      for (const r of FACE_ORDER) merged.confusion[e][r] += acc.confusion[e][r];
    }
  }
  return {
    redOrange: hotspot(merged, "red↔orange", ro0, ro1),
    whiteYellow: hotspot(merged, "white↔yellow", wy0, wy1),
  };
}

// --- Summary -----------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** Multi-line human summary of the whole run: conditions, min, PASS/FAIL, hotspots. */
export function formatRunSummary(
  run: AccuracyRun,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): string {
  const gate = gatePass(run, passFrac);
  const lines: string[] = [];
  lines.push(
    `Gate (min-over-conditions, Wilson-LB ≥ ${pct(passFrac)}): ${gate.pass ? "PASS" : "FAIL"}`,
  );
  const dropReasonsOf = (r: AccuracyRun, key: ConditionKey): string => {
    const acc = r.get(condKeyString(key));
    const entries = Object.entries(acc?.dropReasons ?? {}).filter(([, n]) => n > 0);
    if (entries.length === 0) return "";
    return ` [${entries.map(([reason, n]) => `${reason} ${n}`).join(", ")}]`;
  };
  if (gate.conditions.length === 0) {
    lines.push("Нет данных: ни одного условия не набрано.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("Условия (эталон | свет | кубик | человек | калибровка):");
  for (const c of gate.conditions) {
    const k = c.key;
    const flags: string[] = [];
    if (!c.enoughReads) flags.push(`нужно ≥${MIN_READS} чтений`);
    if (c.dropRate > MAX_DROP_RATE) flags.push(`drop ${pct(c.dropRate)} > ${pct(MAX_DROP_RATE)}`);
    lines.push(
      `  [${c.pass ? "PASS" : "FAIL"}] ${k.mode} | ${k.light} | ${k.cube} | ${k.person} | ${k.calib}: ` +
        `${pct(c.fraction)} (Wilson-LB ${pct(c.wilsonLower)}), ` +
        `n=${c.nScored}, drop=${c.nDropped} (${pct(c.dropRate)})` +
        // Гистограмма причин копилась с первого дня и никуда не печаталась.
        // «drop=3» без причин — это «что-то пошло не так»: протокол требует
        // видеть, чего именно, потому что нечитаемая грань и несобранный скрамбл
        // говорят о разном (первое — про зрение, второе — про тестировщика).
        dropReasonsOf(run, c.key) +
        (flags.length ? ` — ${flags.join("; ")}` : ""),
    );
  }
  if (gate.min) {
    const m = gate.min;
    lines.push("");
    lines.push(
      `Худшее условие: ${m.key.mode} | ${m.key.light} | ${m.key.cube} | ${m.key.person} — ` +
        `Wilson-LB ${pct(m.wilsonLower)}`,
    );
  }
  const hs = runHotspots(run);
  lines.push("");
  lines.push("Hotspots (по всем условиям):");
  lines.push(
    `  ${hs.redOrange.label}: ${hs.redOrange.total} ошибок из N=${hs.redOrange.n} ` +
      `(R→L ${hs.redOrange.aToB}, L→R ${hs.redOrange.bToA})`,
  );
  lines.push(
    `  ${hs.whiteYellow.label}: ${hs.whiteYellow.total} ошибок из N=${hs.whiteYellow.n} ` +
      `(U→D ${hs.whiteYellow.aToB}, D→U ${hs.whiteYellow.bToA})`,
  );
  return lines.join("\n");
}
