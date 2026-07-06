// Accuracy harness (the R1 risk-killer gate). Scores PER-STICKER over all 54 and
// builds a per-color confusion matrix. PASS iff >= ACCURACY_PASS_FRAC of stickers
// are correct at normal light.
//
// GROUND TRUTH — two novice-runnable modes (no notation), see gateHandMix / B:
//   Mode A "перемешай руками": the user hand-scrambles (no formulas) and shows
//     the 6 faces. The existing pipeline (assignFacesByCenter -> resolveRotations)
//     yields a LEGALITY-RESOLVED 54-char state — legality physically pins the
//     answer. We then score the RAW per-sticker argmin classification against that
//     resolved state. This measures the CLASSIFIER on a genuinely mixed cube
//     (adjacent red<->orange = the R1 risk). If resolve is ambiguous/failed we do
//     NOT score garbage — the caller re-prompts.
//   Mode B "собранный кубик": score vs the known SOLVED string. Simple sanity;
//     solid faces don't test adjacency.
//
// The old KNOWN-scramble path (scoreRead vs scrambleToFacelets) stays for the
// product (server side), but is NOT the manual Stage-0 gate.
//
// This module is pure: it takes already-read facelet strings. main.ts wires the
// camera read + pipeline; accuracy.ts just scores.

import { config } from "./config.ts";
import { SOLVED, FACE_ORDER, type Face, type Facelet } from "./cubeState.ts";

export interface StickerResult {
  index: number;
  face: Face;
  cellInFace: number;
  read: string;
  expected: string;
  correct: boolean;
}

export interface AccuracyReport {
  total: number;
  correct: number;
  fraction: number;
  pass: boolean;
  stickers: StickerResult[];
  // confusion[expected][read] = count
  confusion: Record<Face, Record<Face, number>>;
}

export function scoreRead(
  read: Facelet,
  expected: Facelet,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): AccuracyReport {
  const stickers: StickerResult[] = [];
  const confusion = emptyConfusion();
  let correct = 0;

  const n = 54;
  for (let i = 0; i < n; i++) {
    const r = read[i];
    const e = expected[i];
    const isCorrect = r === e;
    if (isCorrect) correct++;
    stickers.push({
      index: i,
      face: FACE_ORDER[Math.floor(i / 9)],
      cellInFace: i % 9,
      read: r,
      expected: e,
      correct: isCorrect,
    });
    if (isFace(e) && isFace(r)) confusion[e as Face][r as Face] += 1;
  }

  const fraction = correct / n;
  return {
    total: n,
    correct,
    fraction,
    pass: fraction >= passFrac,
    stickers,
    confusion,
  };
}

function isFace(c: string): boolean {
  return (FACE_ORDER as readonly string[]).includes(c);
}

function emptyConfusion(): Record<Face, Record<Face, number>> {
  const m = {} as Record<Face, Record<Face, number>>;
  for (const a of FACE_ORDER) {
    m[a] = {} as Record<Face, number>;
    for (const b of FACE_ORDER) m[a][b] = 0;
  }
  return m;
}

/** Human-readable multi-line report string for printing to the page. */
export function formatReport(rep: AccuracyReport): string {
  const lines: string[] = [];
  lines.push(
    `Per-sticker accuracy: ${rep.correct}/${rep.total} = ${(rep.fraction * 100).toFixed(1)}% -> ${rep.pass ? "PASS" : "FAIL"} (gate >=${(config.ACCURACY_PASS_FRAC * 100).toFixed(0)}%)`,
  );
  lines.push("");
  lines.push("Confusion (rows=expected, cols=read):");
  lines.push("     " + FACE_ORDER.map((f) => f.padStart(4)).join(""));
  for (const e of FACE_ORDER) {
    const row = FACE_ORDER.map((r) => String(rep.confusion[e][r]).padStart(4)).join("");
    lines.push(`  ${e}: ${row}`);
  }
  const wrong = rep.stickers.filter((s) => !s.correct);
  if (wrong.length) {
    lines.push("");
    lines.push("Mismatches:");
    for (const s of wrong) {
      lines.push(`  ${s.face}[${s.cellInFace}] (idx ${s.index}): read ${s.read}, expected ${s.expected}`);
    }
  }
  return lines.join("\n");
}

// ---- Novice gate modes (no notation) --------------------------------------

/**
 * Mode A "перемешай руками". Score the RAW per-sticker classification against a
 * ground truth that was independently RESOLVED to a legal cube by the pipeline
 * (assignFacesByCenter + resolveRotations, done by the caller).
 *
 * @param rawRead  the 54-char argmin classification (what the classifier "saw",
 *                 unconstrained by quota — the thing under test)
 * @param resolved the legality-resolved 54-char ground truth from resolveRotations
 *
 * Both must be aligned in URFDLB order (the caller assembles rawRead in the same
 * capture/face order the resolver used). Returns null when `resolved` is not a
 * usable ground truth, so the caller shows "re-show / change light" instead of
 * scoring garbage.
 */
export function gateHandMix(
  rawRead: Facelet,
  resolved: Facelet | null,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): AccuracyReport | null {
  if (!resolved || resolved.length !== 54 || rawRead.length !== 54) return null;
  return scoreRead(rawRead, resolved, passFrac);
}

/**
 * Mode B "собранный кубик". Score the raw classification of a SOLVED cube against
 * the known SOLVED string. Simple sanity — solid faces, no adjacency test.
 */
export function gateSolved(
  rawRead: Facelet,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): AccuracyReport | null {
  if (rawRead.length !== 54) return null;
  return scoreRead(rawRead, SOLVED, passFrac);
}
