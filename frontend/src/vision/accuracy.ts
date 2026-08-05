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

/**
 * Счёт при СВОБОДНОЙ ХВАТКЕ: кубик разрешено вертеть как удобно, показывая
 * нужный центр любой стороной вверх.
 *
 * Зачем. Строгий счёт требует фиксированного выравнивания, потому что выводить
 * его из чтения — циркулярность. Но живой прогон дал 54/54 «с точностью до
 * поворота» при 33% строгих: зрение было идеально, а мерили хватку. Держать
 * ориентацию двадцать чтений подряд × три света × два кубика — работа, которая
 * к R1 отношения не имеет.
 *
 * Как это остаётся честным:
 *
 *  1. Какая грань показана, решает ЦЕНТР — данные, а не подгонка под ответ.
 *     Ошибся центр — вся грань уезжает в чужой слот и разваливается, то есть
 *     ошибка наказывается, а не прощается. Центры при этом ИЗ СЧЁТА ИСКЛЮЧЕНЫ:
 *     иначе шесть наклеек были бы верны по построению, +11% из воздуха.
 *  2. Внутри грани сравниваются МУЛЬТИМНОЖЕСТВА восьми не-центральных цветов, а
 *     не позиции. Поворот грани мультимножество не меняет, поэтому подбирать
 *     поворот (а значит, подгонять под ответ) не приходится вовсе.
 *
 * Чем платим, прямым текстом: перестановка двух наклеек ВНУТРИ грани невидима —
 * мультимножество то же. Это ошибка геометрии, не цвета; её ловят строгий режим
 * и телеметрия подгонки сетки. Поэтому свободная хватка — отдельная ось условия,
 * её числа не смешиваются со строгими.
 *
 * Какая ячейка объявлена промахом при повторяющихся цветах, зависит от порядка
 * обхода (побеждают первые) — КОЛИЧЕСТВО при этом точное. Пары «прочитано →
 * ожидалось» для матрицы путаницы собираются зипом остатков в каноническом
 * порядке: внутри грани это приближение, счёт верных — нет.
 */
export type FreeGripScore =
  | { kind: "assign-conflict"; reason: string }
  | { kind: "ok"; report: AccuracyReport; faceOf: Face[] };

export function scoreFreeGrip(
  faceGrids: Face[][],
  expected: Facelet,
  passFrac: number = config.ACCURACY_PASS_FRAC,
  /**
   * Готовое выравнивание: какой гранью была каждая съёмка. Приходит из
   * `cubeGrid.assignFacesByCenter` по СЫРЫМ центрам — раскладка шести съёмок по
   * шести цветам целиком, со своим замком на «центр далеко от выданного цвета».
   *
   * Без него грань называет одиночный argmin по центру, а он на тёплом свете
   * отдаёт один и тот же цвет двум съёмкам (порыжевший красный центр ближе к
   * оранжевому эталону, чем к своему) — и всё чтение уходит в дроп, хотя человек
   * показал ровно шесть разных граней. Подгонкой под ответ это не является:
   * эталон в раскладке не участвует, решают только цвета центров.
   */
  faceOfOverride?: Face[],
): FreeGripScore {
  if (faceGrids.length !== 6 || faceGrids.some((g) => g.length !== 9)) {
    return { kind: "assign-conflict", reason: "нужно ровно 6 граней по 9 ячеек" };
  }
  // (a) Кто есть кто — по центру каждой съёмки.
  const faceOf = faceOfOverride?.length === 6 ? [...faceOfOverride] : faceGrids.map((g) => g[4]);
  const counts: Record<string, number> = {};
  for (const f of faceOf) counts[f] = (counts[f] ?? 0) + 1;
  for (const f of FACE_ORDER) {
    if (counts[f] !== 1) {
      return {
        kind: "assign-conflict",
        reason: `центр грани ${f} встретился ${counts[f] ?? 0} раз вместо одного — показаны не все шесть граней или центр прочитан неверно`,
      };
    }
  }

  const slotOf: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const stickers: StickerResult[] = [];
  const confusion = emptyConfusion();
  let correct = 0;
  let total = 0;

  for (let cap = 0; cap < 6; cap++) {
    const face = faceOf[cap];
    const exp = expected.slice(slotOf[face] * 9, slotOf[face] * 9 + 9).split("") as Face[];
    // (b) Бюджет цветов грани — восемь не-центральных наклеек эталона.
    const budget: Record<string, number> = {};
    for (let j = 0; j < 9; j++) {
      if (j === 4) continue;
      budget[exp[j]] = (budget[exp[j]] ?? 0) + 1;
    }
    const wrongCells: number[] = [];
    for (let j = 0; j < 9; j++) {
      if (j === 4) continue; // центр — ключ выравнивания, в счёт не идёт
      total += 1;
      const read = faceGrids[cap][j];
      if ((budget[read] ?? 0) > 0) {
        budget[read] -= 1;
        correct += 1;
        // Диагональ матрицы нужна и здесь: hotspots считают долю ошибок от
        // ЭКСПОЗИЦИИ (сколько наклеек этого цвета вообще было), а экспозиция
        // берётся из матрицы. Без верных ячеек знаменатель был бы только из
        // промахов, и red↔orange показывал бы 100%.
        confusion[read][read] += 1;
        stickers.push({
          index: cap * 9 + j,
          face,
          cellInFace: j,
          read,
          expected: read,
          correct: true,
        });
      } else {
        wrongCells.push(j);
      }
    }
    // Остаток бюджета — цвета, которых грани не хватило; зипуем с промахами.
    const missing: Face[] = [];
    for (const f of FACE_ORDER) {
      for (let k = 0; k < (budget[f] ?? 0); k++) missing.push(f);
    }
    for (let m = 0; m < wrongCells.length; m++) {
      const j = wrongCells[m];
      const read = faceGrids[cap][j];
      const exp1 = missing[m] ?? read;
      stickers.push({
        index: cap * 9 + j,
        face,
        cellInFace: j,
        read,
        expected: exp1,
        correct: false,
      });
      confusion[exp1][read] += 1;
    }
  }

  stickers.sort((a, b) => a.index - b.index);
  const fraction = total > 0 ? correct / total : 0;
  return {
    kind: "ok",
    faceOf,
    report: { total, correct, fraction, pass: fraction >= passFrac, stickers, confusion },
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
