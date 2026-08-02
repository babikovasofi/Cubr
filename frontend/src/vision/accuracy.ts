// Accuracy harness (the R1 risk-killer gate). Scores PER-STICKER over all 54 and
// builds a per-color confusion matrix. PASS iff >= ACCURACY_PASS_FRAC of stickers
// are correct at normal light.
//
// GROUND TRUTH вЂ” two novice-runnable modes (no notation), see gateHandMix / B:
//   Mode A "РїРµСЂРµРјРµС€Р°Р№ СЂСѓРєР°РјРё": the user hand-scrambles (no formulas) and shows
//     the 6 faces. The existing pipeline (assignFacesByCenter -> resolveRotations)
//     yields a LEGALITY-RESOLVED 54-char state вЂ” legality physically pins the
//     answer. We then score the RAW per-sticker argmin classification against that
//     resolved state. This measures the CLASSIFIER on a genuinely mixed cube
//     (adjacent red<->orange = the R1 risk). If resolve is ambiguous/failed we do
//     NOT score garbage вЂ” the caller re-prompts.
//   Mode B "СЃРѕР±СЂР°РЅРЅС‹Р№ РєСѓР±РёРє": score vs the known SOLVED string. Simple sanity;
//     solid faces don't test adjacency.
//
// The old KNOWN-scramble path (scoreRead vs scrambleToFacelets) stays for the
// product (server side), but is NOT the manual Stage-0 gate.
//
// This module is pure: it takes already-read facelet strings. main.ts wires the
// camera read + pipeline; accuracy.ts just scores.

import { config } from "./config";
import { SOLVED, FACE_ORDER, type Face, type Facelet } from "./cubeState";

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

/**
 * Почему ячейка прочиталась именно так — по одной записи на все 54, в том же
 * фиксированном порядке URFDLB.
 *
 * Одного «прочиталось U вместо F» мало: так выглядят сразу три разные болезни, и
 * лечатся они по-разному. Пересвет — ячейка выбита в белое, `kept` мал. Плохая
 * геометрия — ячейка села мимо, `kept` при этом большой (фон ровный), а ΔE до
 * победителя мал. Слипшиеся эталоны — `kept` большой, но `margin` крошечный,
 * второй кандидат дышит в затылок. Без этих трёх чисел отчёт заставляет гадать.
 */
export interface CellDiag {
  /** Доля пикселей ячейки, выживших отбраковку блика/тени (0..1). */
  kept: number;
  /**
   * Сам цвет ячейки. Нужен, когда до ближайшего эталона далеко: цифра ΔE говорит
   * «это не цвет кубика», но не говорит, ЧТО это. Тёмно-оливковый — жёлтая грань
   * в тени, лечится нормировкой света. Бежево-коричневый — столешница или рука,
   * лечится геометрией. Разные болезни, одинаковое ΔE.
   */
  rgb: [number, number, number];
  /** Ближайший эталон (он и есть сырое чтение) и ΔE до него. */
  best: string;
  bestDE: number;
  /** Второй по близости эталон и ΔE до него. */
  second: string;
  secondDE: number;
}

/**
 * Как легла сетка на каждой из шести граней.
 *
 * Признак решётки (тёмные щели по границам ячеек) — единственное, чем подгонка
 * отличает грань кубика от ровного светлого фона. На кубике с наклейками щели
 * чёрные и контраст велик; на монолитном (stickerless) щель — это только тень
 * между деталями, и контраст может не дотянуть до FACE_FIT_GAP_TARGET. Тогда
 * выигрыш кандидата над рамкой падает ниже FACE_FIT_MIN_GAIN, подгонка молча
 * откатывается на рамку, и разбираться приходится по симптомам. Эти три числа
 * говорят прямо: был ли выигрыш, приняли ли подгонку, есть ли решётка вообще.
 */
export interface FaceFitDiag {
  /** baselineCost - cost выбранного кандидата: больше нуля — подгонка нашла лучше рамки. */
  gain: number;
  /** Приняли ли подгонку (gain >= FACE_FIT_MIN_GAIN) или порезали по рамке. */
  used: boolean;
  /** Средний по 9 ячейкам контраст окантовки, единицы яркости 0..255. */
  gap: number;
}

/** Human-readable multi-line report string for printing to the page. */
export function formatReport(
  rep: AccuracyReport,
  diags?: readonly CellDiag[],
  fits?: readonly FaceFitDiag[],
): string {
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
      const d = diags?.[s.index];
      const why = d
        ? ` | RGB(${d.rgb.join(",")})` +
          `, kept ${(d.kept * 100).toFixed(0)}%` +
          `${d.kept < config.CELL_MIN_KEPT_FRAC ? " (ВЫБИТА)" : ""}` +
          `, ΔE ${d.best} ${d.bestDE.toFixed(1)} / ${d.second} ${d.secondDE.toFixed(1)}` +
          `, отрыв ${(d.secondDE - d.bestDE).toFixed(1)}` +
          `${d.bestDE > config.STICKER_MAX_DELTA_E ? " (НЕ ЦВЕТ КУБИКА)" : ""}`
        : "";
      lines.push(
        `  ${s.face}[${s.cellInFace}] (idx ${s.index}): read ${s.read}, expected ${s.expected}${why}`,
      );
    }
  }
  if (diags) {
    const blown = diags.filter((d) => d.kept < config.CELL_MIN_KEPT_FRAC).length;
    const tight = diags.filter((d) => d.secondDE - d.bestDE < config.STICKER_MARGIN_MIN).length;
    const far = diags.filter((d) => d.bestDE > config.STICKER_MAX_DELTA_E).length;
    // Медиана ΔE до ближайшего эталона по всем 54 — одно число про то, «попадает
    // ли зрение вообще». У здорового чтения единицы, у больного — десятки.
    const sorted = diags.map((d) => d.bestDE).sort((a, b) => a - b);
    const medianDE = sorted.length
      ? sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : 0;
    lines.push("");
    lines.push("Почему ошиблись (по всем 54 ячейкам):");
    lines.push(
      `  выбитых пересветом (kept < ${(config.CELL_MIN_KEPT_FRAC * 100).toFixed(0)}%): ${blown}`,
    );
    lines.push(`  без отрыва от второго кандидата (< ${config.STICKER_MARGIN_MIN}): ${tight}`);
    lines.push(`  не похожих ни на один цвет кубика (ΔE > ${config.STICKER_MAX_DELTA_E}): ${far}`);
    lines.push(`  медианный ΔE до ближайшего эталона: ${medianDE.toFixed(1)}`);
  }
  if (fits?.length) {
    const fellBack = fits.filter((f) => !f.used).length;
    lines.push("");
    lines.push("Подгонка сетки (по граням в порядке URFDLB):");
    for (let i = 0; i < fits.length; i++) {
      const f = fits[i];
      lines.push(
        `  ${FACE_ORDER[i] ?? i}: выигрыш ${f.gain.toFixed(2)} (порог ${config.FACE_FIT_MIN_GAIN})` +
          `, ${f.used ? "ПОДОГНАНА" : "ОТКАТ НА РАМКУ"}` +
          `, контраст щелей ${f.gap.toFixed(1)} (цель ${config.FACE_FIT_GAP_TARGET})`,
      );
    }
    lines.push(`  откатов на рамку: ${fellBack} из ${fits.length}`);
  }
  return lines.join("\n");
}

// ---- Novice gate modes (no notation) --------------------------------------

/**
 * Mode A "РїРµСЂРµРјРµС€Р°Р№ СЂСѓРєР°РјРё". Score the RAW per-sticker classification against a
 * ground truth that was independently RESOLVED to a legal cube by the pipeline
 * (assignFacesByCenter + resolveRotations, done by the caller).
 *
 * @param rawRead  the 54-char argmin classification (what the classifier "saw",
 *                 unconstrained by quota вЂ” the thing under test)
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
 * Mode B "СЃРѕР±СЂР°РЅРЅС‹Р№ РєСѓР±РёРє". Score the raw classification of a SOLVED cube against
 * the known SOLVED string. Simple sanity вЂ” solid faces, no adjacency test.
 */
export function gateSolved(
  rawRead: Facelet,
  passFrac: number = config.ACCURACY_PASS_FRAC,
): AccuracyReport | null {
  if (rawRead.length !== 54) return null;
  return scoreRead(rawRead, SOLVED, passFrac);
}
