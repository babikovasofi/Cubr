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
import { pinRotationsByPhysics, rotateGrid } from "./cubeGrid";
import { SOLVED, FACE_ORDER, type Face, type Facelet } from "./cubeState";
import { deltaE, rgb2lab } from "./colors";
import { fitSpreadRu } from "./guide";

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

/**
 * Счёт «ПО КАРТИНКЕ»: грань сравнивается с эталонной гранью ПОЗИЦИОННО, но с
 * точностью до её поворота в кадре (0/90/180/270).
 *
 * Ритуал, который этот режим обслуживает: харнесс говорит «покажи грань с зелёным
 * центром», человек показывает её плашмя в камеру, но кубик при этом перекачен
 * как удобно — сверху может оказаться любая грань. Значит квадрат 3×3 приезжает
 * повёрнутым, и сравнивать надо две картинки, а не два мешка цветов.
 *
 * Чем он лучше свободной хватки. Та сравнивает МУЛЬТИМНОЖЕСТВА и потому слепа к
 * перестановке наклеек внутри грани — а это ровно тот отказ, который даёт съехавшая
 * сетка. Здесь перестановка видна: её не спасает ни один из четырёх поворотов.
 * Продукту нужны именно позиции (из них собирается состояние для cubejs), поэтому
 * этот режим меряет то же свойство, которым продукт и пользуется.
 *
 * Чем он лучше строгой хватки. Не требует держать кубик в одной ориентации
 * двадцать чтений подряд — то есть не мерит руки вместо зрения.
 *
 * ЧЕСТНОСТЬ. Поворот берётся из ФИЗИКИ кубика (`pinRotationsByPhysics`), а не из
 * совпадения с ответом: ожидаемый скрамбл в выборе поворота не участвует вообще.
 * Ошибка цвета физику нарушает, то есть наказывается. Если физика поворот НЕ
 * определила (`tied > 1`), режим честно говорит об этом отдельным исходом —
 * подбирать поворот под ответ здесь нельзя, это и есть survivorship bias.
 *
 * Центры из счёта исключены (48, не 54): грань опознаётся по центру, значит центр
 * верен по построению и дал бы +11% из воздуха. Та же логика, что в свободной хватке.
 */
export type PictureGripScore =
  | { kind: "assign-conflict"; reason: string }
  | { kind: "rotation-ambiguous"; reason: string; violations: number; tied: number }
  | { kind: "ok"; report: AccuracyReport; rotations: number[]; violations: number };

export function scorePictureGrip(
  faceGrids: Face[][],
  expected: Facelet,
  faceOf: Face[],
  passFrac: number = config.ACCURACY_PASS_FRAC,
): PictureGripScore {
  if (faceGrids.length !== 6 || faceGrids.some((g) => g.length !== 9)) {
    return { kind: "assign-conflict", reason: "нужно ровно 6 граней по 9 ячеек" };
  }
  const pin = pinRotationsByPhysics(faceGrids, faceOf);
  if (!pin.ok || !pin.rotations) {
    return { kind: "assign-conflict", reason: pin.reason ?? "повороты не выведены" };
  }
  if ((pin.tied ?? 1) > 1) {
    return {
      kind: "rotation-ambiguous",
      reason: `физика не определила поворот граней: ${pin.tied} комбинаций нарушают её одинаково (${pin.violations})`,
      violations: pin.violations ?? 0,
      tied: pin.tied ?? 0,
    };
  }

  const slotOf: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const stickers: StickerResult[] = [];
  const confusion = emptyConfusion();
  let correct = 0;
  let total = 0;

  for (let cap = 0; cap < 6; cap++) {
    const face = faceOf[cap];
    const slot = slotOf[face];
    const exp = expected.slice(slot * 9, slot * 9 + 9).split("") as Face[];
    const rotated = rotateGrid(faceGrids[cap], pin.rotations[cap]);
    // Куда уехала каждая ячейка при повороте: sourceOf[j] — номер ячейки в
    // ИСХОДНОЙ съёмке, попавшей на место j после поворота.
    //
    // Без этого `index` считался по повёрнутой позиции и по слоту URFDLB, а
    // диагностика ячеек (`cellDiagnostics`) лежит в порядке СЪЁМОК и БЕЗ
    // поворота. Отчёт зипует их по `index` — и печатал RGB одной ячейки рядом с
    // «прочитано/ожидалось» совсем другой. Живой прогон дал строку
    // «read U, expected D … ΔE D 6.4»: победитель D, а прочитано якобы U, чего
    // быть не может. Счёт верных при этом был верен всегда — расходилась только
    // диагностика, то есть врало именно то, по чему чинят зрение.
    const sourceOf = rotateGrid([0, 1, 2, 3, 4, 5, 6, 7, 8], pin.rotations[cap]);
    for (let j = 0; j < 9; j++) {
      if (j === 4) continue; // центр — ключ выравнивания, в счёт не идёт
      total += 1;
      const read = rotated[j];
      const isCorrect = read === exp[j];
      if (isCorrect) correct += 1;
      const src = sourceOf[j];
      stickers.push({
        index: cap * 9 + src,
        face,
        cellInFace: src,
        read,
        expected: exp[j],
        correct: isCorrect,
      });
      confusion[exp[j]][read] += 1;
    }
  }

  stickers.sort((a, b) => a.index - b.index);
  const fraction = total > 0 ? correct / total : 0;
  return {
    kind: "ok",
    rotations: pin.rotations,
    violations: pin.violations ?? 0,
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
  /**
   * Доля пикселей ячейки в гамме кожи (colors.skinFraction), 0..1.
   *
   * Мерится, а не выводится из расстояния до «среднего телесного»: кожа лежит
   * рядом с оранжевой наклейкой в Lab, и сравнение ΔE честно отвечает
   * «оранжевый» на палец. Разделяет их хрома в YCbCr, а не близость в Lab.
   */
  skin?: number;
  /**
   * Насколько ячейка светлее самого светлого эталона калибровки (L в Lab).
   *
   * Отдельно от `kept`, потому что ловит другое. `kept` считает долю КЛИПНУТЫХ
   * пикселей — ячейку, съеденную пересветом целиком. Равномерная плёнка блика
   * ничего не клипует: она тянет цвет наклейки к цвету источника, `kept`
   * остаётся 100%, а ΔE уверенно указывает на белый. Живой прогон 2026-08-21
   * дал ровно это — зелёные ячейки грани U прочитаны белыми при kept 75–100%.
   *
   * НЕОБЯЗАТЕЛЬНОЕ: отчёты, снятые до появления замера, поля не несут.
   */
  lift?: number;
  /** Хрома ячейки (colors.chroma) — второй половиной того же признака. */
  chroma?: number;
}

/**
 * Похожа ли ячейка на наклейку под плёнкой блика: светлее снятого белого И без
 * цвета.
 *
 * Нужны ОБА условия. Одна светлота ловила бы честный белый на ярко освещённой
 * грани; одна хрома — любую белую наклейку, у которой хромы нет по определению.
 * Вместе они описывают то, чего у настоящей наклейки не бывает: белее самого
 * светлого эталона в этом же свете.
 *
 * ТЕЛЕМЕТРИЯ. Ни одного отказа на этом признаке нет намеренно: отказ меняет
 * drop-rate, то есть само число гейта, и старые чтения стали бы несравнимы.
 * Сначала смотрим, сколько таких ячеек и совпадают ли они с промахами.
 */
export function glareFilmSuspect(d: CellDiag): boolean {
  if (d.lift === undefined || d.chroma === undefined) return false;
  return d.lift >= config.GLARE_LIFT_L && d.chroma <= config.GLARE_MAX_CHROMA;
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
  /**
   * Средний по 9 ячейкам контраст ВНУТРЕННИХ границ (ΔE, см. vision/faceFit
   * edgeContrast) — признак ДЛЯ STICKERLESS, у которого физического зазора нет.
   *
   * НЕОБЯЗАТЕЛЬНОЕ поле, а не задуманно-обязательное (как исходно намечал план
   * этой задачи): продюсер телеметрии — `useCubeReader.ts`, а он вне рамок этой
   * правки (заблокирован пользователем отдельно, вместе с машинерией отказа).
   * Поле объявлено здесь и покрыто тестами заранее, но реально заполнится
   * только когда `useCubeReader.ts` начнёт передавать `edgeContrast(...)` —
   * отдельная задача. До тех пор `formatReport` печатает то, что есть.
   */
  edge?: number;
  /** См. `FitResult.margin` (vision/faceFit). Тот же комментарий про `edge`. */
  margin?: number;
  /** См. `FitResult.decided` (vision/faceFit). Тот же комментарий про `edge`. */
  decided?: boolean;
}

/**
 * Сколько раз каждый цвет встретился в сыром чтении при норме девять.
 *
 * Самая дешёвая проверка на свете и самая наглядная: на кубике по девять
 * наклеек каждого цвета, точка. Перекос значит, что цвета перепутаны — и
 * говорит это ДО поворотов, эталона и физики, то есть тогда, когда все прочие
 * сообщения ещё рассуждают о своём.
 *
 * Живой прогон 2026-08-19 отказал словами «физика не определила поворот граней:
 * 2 комбинации нарушают её одинаково (6)» — формально верно и бесполезно.
 * Баланс на тех же данных: R 5 при норме 9, L 12, U 12. Четыре красных
 * прочитаны не красными — вот отчего физика и не сошлась, и это R1, главный
 * риск проекта, а не свойство поворотов.
 *
 * Строка печатается ТОЛЬКО при перекосе: у здорового чтения она была бы шумом.
 */
export function colorBalanceRu(grids: readonly (readonly string[])[]): string | null {
  const counts = new Map<string, number>();
  for (const g of grids) for (const c of g) counts.set(c, (counts.get(c) ?? 0) + 1);
  const off = [...counts.entries()]
    .filter(([, n]) => n !== 9)
    .sort((a, b) => Math.abs(b[1] - 9) - Math.abs(a[1] - 9));
  if (off.length === 0) return null;
  const parts = off.map(([c, n]) => `${c} ${n} (${n > 9 ? "+" : "\u2212"}${Math.abs(n - 9)})`);
  const worst = off[0];
  const tail =
    worst[1] < 9
      ? ` Больше всего недостаёт цвета ${worst[0]}: ${9 - worst[1]} наклеек прочитаны не им.`
      : ` Больше всего лишнего цвета ${worst[0]}: +${worst[1] - 9}.`;
  return `Баланс цветов (на кубике ровно по 9): ${parts.join(", ")}.${tail}`;
}

/**
 * Все 9 ячеек каждой съёмки — сырым argmin, без раскладки и без квот.
 *
 * Зачем отдельно от `formatReport`. Тот печатает промахи ПРОЧИТАННОГО кубика, а
 * съёмка, развалившаяся на раскладке центров, до счёта не доходит вовсе: в
 * отчёт не попадает ни одна её ячейка. Живой прогон 2026-08-19 (stickerless,
 * LED) уперся ровно в это: три чтения подряд ушли в дроп, наружу торчали только
 * шесть центров, и по ним неразличимы две болезни с противоположным лечением —
 * человек показал одну грань дважды, ИЛИ сетка села на грань со сдвигом и
 * «центром» стала соседняя наклейка. Грань целиком разводит их сразу: у сдвига
 * ряды выглядят как срез чужой грани, у дубликата — как честная грань, просто
 * не та.
 *
 * Строчная буква = ΔE до ближайшего эталона больше `STICKER_MAX_DELTA_E`: ячейка
 * не похожа ни на один цвет кубика (щель, фон, блик). Три строчных подряд в
 * крайнем ряду — почерк сползшей сетки, и это видно глазом без единого числа.
 */
export function formatRawGrids(
  grids: readonly (readonly string[])[],
  diags?: readonly CellDiag[],
  fits?: readonly FaceFitDiag[],
): string {
  const lines: string[] = [];
  // Баланс идёт ПЕРВЫМ: он один отвечает на вопрос «чтение вообще возможно?»,
  // и без него человек читает буквы, не зная, что искать.
  const balance = colorBalanceRu(grids);
  if (balance) lines.push(balance);
  lines.push(
    "Ячейки съёмок (сырой argmin, 3 ряда по 3, центр в скобках; строчная буква — " +
      `ΔE больше ${config.STICKER_MAX_DELTA_E}, то есть не цвет кубика):`,
  );
  grids.forEach((grid, cap) => {
    const cells = grid.map((face, i) => {
      const d = diags?.[cap * 9 + i];
      const ch = d && d.bestDE > config.STICKER_MAX_DELTA_E ? face.toLowerCase() : face;
      return i === 4 ? `(${ch})` : ` ${ch} `;
    });
    const rows = [cells.slice(0, 3), cells.slice(3, 6), cells.slice(6, 9)].map((r) => r.join(""));
    const capDiags = diags?.slice(cap * 9, cap * 9 + 9);
    let tail = "";
    if (capDiags && capDiags.length === 9) {
      const worst = Math.max(...capDiags.map((d) => d.bestDE));
      const blown = capDiags.filter((d) => d.kept < config.CELL_MIN_KEPT_FRAC).length;
      // Худшая ячейка по доле выживших пикселей, а не только счётчик выбитых.
      // Порог `CELL_MIN_KEPT_FRAC` ловит ячейку, которую блик съел целиком; блик
      // на ПОЛОВИНЕ ячейки его не достигает, но цвет уже тянет к белому — и
      // именно так тёмно-синяя наклейка становится белой, не подняв ни одного
      // флага. Живой прогон 2026-08-19: синего 6 из 9 при здоровых эталонах.
      const minKept = Math.min(...capDiags.map((d) => d.kept));
      tail =
        `  [центр ΔE ${capDiags[4].bestDE.toFixed(1)}` +
        `, макс по ячейкам ${worst.toFixed(1)}` +
        `, худшая ячейка выжила на ${(minKept * 100).toFixed(0)}%` +
        (blown ? `, выбито бликом ${blown}` : "") +
        "]";
    }
    lines.push(`  ${cap + 1}: ${rows.join(" | ")}${tail}`);
  });
  // Как легла сетка — часть той же картины: «ячейка прочиталась белой» и «сетка
  // на этой грани ничего не нашла» объясняют друг друга. Раньше эта строка
  // печаталась ровно у одного отказа из шести, и у остальных пяти читателю
  // приходилось гадать о геометрии по буквам.
  if (fits && fits.length > 0) lines.push(`  ${fitSpreadRu([...fits])}`);
  return lines.join("\n");
}

/**
 * Все промахи собрались в одной съёмке, и цвета в ней чистые — значит спорит не
 * зрение, а содержимое грани.
 *
 * Живая сессия 2026-08-20, скрамбл-режим: два чтения по 49/54, и в обоих ВСЕ
 * промахи сидят на съёмке U. Ячейки при этом сняты безупречно — ΔE до своего
 * эталона 1.1…4.3, ни блика, ни выбитых пикселей. Классификатор не ошибался: он
 * прочитал ровно те цвета, что были в кадре. Значит в кадре была не та грань,
 * какую ждал эталон: либо скрамбл на кубике собран не тот, либо эту грань
 * показали повёрнутой (при строгой хватке поворот грани — нарушение).
 *
 * Без этой строки человек видит «5 ошибок» и идёт чинить свет и калибровку —
 * то есть ровно то, что здесь ни при чём.
 *
 * Пороги. `MIN` — меньше трёх промахов не образуют «почерка», это шум. `SHARE`
 * — доля одной съёмки: 0.8 отделяет «всё в одной» от размазанного по кубику.
 * `CLEAN_DE` — что считать чистым цветом: 8 вчетверо ниже
 * `STICKER_MAX_DELTA_E` и вдвое выше типичной медианы здорового чтения (2–4).
 */
export function concentratedMismatchRu(
  wrong: readonly StickerResult[],
  diags?: readonly CellDiag[],
): string | null {
  const MIN = 3;
  const SHARE = 0.8;
  const CLEAN_DE = 8;
  if (wrong.length < MIN) return null;

  const byFace = new Map<string, StickerResult[]>();
  for (const s of wrong) {
    const list = byFace.get(s.face) ?? [];
    list.push(s);
    byFace.set(s.face, list);
  }
  let worst: { face: string; list: StickerResult[] } | null = null;
  for (const [face, list] of byFace) {
    if (!worst || list.length > worst.list.length) worst = { face, list };
  }
  if (!worst || worst.list.length < wrong.length * SHARE) return null;

  // Чистота — по диагностике тех самых ячеек. Без неё утверждать нечего:
  // грязные цвета означали бы как раз ошибку зрения, а не подмену содержимого.
  if (!diags) return null;
  const des = worst.list.map((s) => diags[s.index]?.bestDE).filter((d): d is number => d != null);
  if (des.length !== worst.list.length) return null;
  const worstDE = Math.max(...des);
  if (worstDE > CLEAN_DE) return null;

  return (
    `Почерк: все ${wrong.length} промахов — в одной съёмке (грань ${worst.face}), и цвета в ней ` +
    `сняты чисто (худший ΔE ${worstDE.toFixed(1)} при пороге «не цвет кубика» ` +
    `${config.STICKER_MAX_DELTA_E}). Зрение прочитало то, что было в кадре, — значит в кадре ` +
    "была не та грань, какую ждёт эталон: либо на кубике собран не тот скрамбл, либо эта грань " +
    "показана повёрнутой. Свет и калибровку здесь чинить нечего."
  );
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
          `${d.bestDE > config.STICKER_MAX_DELTA_E ? " (НЕ ЦВЕТ КУБИКА)" : ""}` +
          `${
            glareFilmSuspect(d)
              ? ` (ПЛЁНКА БЛИКА: светлее белого на ${d.lift!.toFixed(1)}, хрома ${d.chroma!.toFixed(1)})`
              : ""
          }`
        : "";
      lines.push(
        `  ${s.face}[${s.cellInFace}] (idx ${s.index}): read ${s.read}, expected ${s.expected}${why}`,
      );
    }
    const verdict = concentratedMismatchRu(wrong, diags);
    if (verdict) {
      lines.push("");
      lines.push(verdict);
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
    // Плёнка блика — то, чего не видит счётчик выше: kept у таких ячеек целый.
    // Печатается только там, где замер есть (старые отчёты поля не несут), и
    // сразу с раскладкой «сколько из них ушло в промах»: признак, совпадающий с
    // промахами, объясняет чтение, а признак, рассыпанный по верным ячейкам,
    // означает, что порог взят слишком низко и его надо двигать, а не верить.
    const measuredLift = diags.some((d) => typeof d.lift === "number");
    if (measuredLift) {
      const veiled: number[] = [];
      diags.forEach((d, i) => {
        if (glareFilmSuspect(d)) veiled.push(i);
      });
      const wrongIdx = new Set(wrong.map((s) => s.index));
      const veiledWrong = veiled.filter((i) => wrongIdx.has(i)).length;
      lines.push(
        `  белее калиброванного белого при упавшей хроме (плёнка блика, kept целый): ` +
          `${veiled.length}, из них в промахах: ${veiledWrong}`,
      );
    }
    // Пальцы в кадре — измеренная величина, а не догадка по расстоянию.
    //
    // Раньше здесь считалось «ячейка ближе к среднему телесному тону, чем к
    // своему эталону», и это заведомо занижало счёт: кожа ближе к ОРАНЖЕВОЙ
    // наклейке, чем к среднему телесному, поэтому закрытая пальцем ячейка в
    // старый счётчик часто не попадала. Теперь берётся доля пикселей ячейки в
    // гамме кожи (YCbCr), посчитанная на самом кадре.
    const measured = diags.filter((d) => typeof d.skin === "number");
    if (measured.length > 0) {
      const touched = measured.filter((d) => (d.skin ?? 0) > config.CELL_SKIN_FRAC_MAX).length;
      const grazed = measured.filter(
        (d) => (d.skin ?? 0) > 0.1 && (d.skin ?? 0) <= config.CELL_SKIN_FRAC_MAX,
      ).length;
      lines.push(
        `  закрытых пальцем (кожи больше ${(config.CELL_SKIN_FRAC_MAX * 100).toFixed(0)}%): ${touched}` +
          `, задетых краем пальца: ${grazed}`,
      );
    } else {
      // Старая оценка остаётся для отчётов, снятых до появления замера.
      const skinLab = rgb2lab(config.FACE_FIT_SKIN_RGB);
      const skinLike = diags.filter((d) => deltaE(rgb2lab(d.rgb), skinLab) < d.bestDE).length;
      lines.push(`  ближе к телесному тону, чем к эталону кубика: ${skinLike}`);
    }
  }
  if (fits?.length) {
    const fellBack = fits.filter((f) => !f.used).length;
    lines.push("");
    lines.push("Подгонка сетки (по граням в порядке URFDLB):");
    for (let i = 0; i < fits.length; i++) {
      const f = fits[i];
      const edge =
        f.edge !== undefined
          ? `, контраст границ ${f.edge.toFixed(1)} (цель ${config.FACE_FIT_EDGE_TARGET})`
          : "";
      const margin =
        f.margin !== undefined && Number.isFinite(f.margin)
          ? `, отрыв ${f.margin.toFixed(2)} (порог ${config.FACE_FIT_MIN_MARGIN})`
          : f.margin !== undefined
            ? `, отрыв ∞ (несогласных соперников нет)`
            : "";
      const decided =
        f.decided !== undefined
          ? `, ${f.decided ? "фаза сетки определена" : "фаза сетки НЕ определена"}`
          : "";
      lines.push(
        `  ${FACE_ORDER[i] ?? i}: выигрыш ${f.gain.toFixed(2)} (порог ${config.FACE_FIT_MIN_GAIN})` +
          `, ${f.used ? "ПОДОГНАНА" : "ОТКАТ НА РАМКУ"}` +
          `, контраст щелей ${f.gap.toFixed(1)} (цель ${config.FACE_FIT_GAP_TARGET})` +
          edge +
          margin +
          decided,
      );
    }
    lines.push(`  откатов на рамку: ${fellBack} из ${fits.length}`);
    // Печатается только когда ХОТЬ ОДНА грань несёт decided: без этого поле
    // необязательное (useCubeReader.ts его пока не заполняет, см. FaceFitDiag),
    // и строка "0 из 6" читалась бы как «все решены», хотя на деле неизвестно.
    if (fits.some((f) => f.decided !== undefined)) {
      const undecidedCount = fits.filter((f) => f.decided === false).length;
      lines.push(`  граней без определённой подгонки: ${undecidedCount} из ${fits.length}`);
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
