// Accuracy harness (the R1 risk-killer gate). GROUND TRUTH comes from cubejs
// applying a KNOWN scramble — never the tester's eyes. We score PER-STICKER over
// all 54 and build a per-color confusion matrix. PASS iff >= ACCURACY_PASS_FRAC
// of stickers are correct at normal light.
//
// This module is pure: it takes an already-read facelet string and the expected
// one. main.ts wires the camera read; accuracy.ts just scores.

import { config } from "./config.ts";
import { FACE_ORDER, type Face, type Facelet } from "./cubeState.ts";

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
