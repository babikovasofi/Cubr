// Canvas-bound cube-face readers (extracted from the prototype's cube.ts). These
// touch getContext/getImageData, so they live in a hook module, not the pure
// cubeGrid. Stage 1.2 adds the stateful part: a minimal inline quick-calibrate
// (6 solved faces → session refs) and a 6-face verify collector that resolves the
// read into a legal cube and diffs it against the scramble's expected facelets.

import { useRef, useState } from "react";
import {
  calibrateByColorIdentity,
  checkCalibration,
  chroma,
  COLOR_NAMES,
  assignQuota,
  cellWeight,
  deltaE,
  robustCellColor,
  skinFraction,
  deltaEClassify,
  fitColorMatrix,
  applyColorMatrix,
  lab2rgb,
  medianAcrossFrames,
  median,
  normalizeFaceByCenter,
  rgb2lab,
  type CalibrationProblem,
  type ColorName,
  type Lab,
  type Refs,
  type RGB,
} from "../colors";
import { quickAdjust as colorsQuickAdjust } from "../quickAdjust";
import { config, squareGuidePx, type Rect } from "../config";
import {
  fitFaceRegion,
  gapContrast,
  edgeContrast,
  latticeVerdict,
  type FitRegion,
} from "../faceFit";
import {
  notACubeFaceRu,
  latticeCollapsedRu,
  latticeCollapsedLateRu,
  wrongFaceRu,
  fingerOnFaceRu,
} from "../guide";
import {
  assignFacesByCenter,
  resolveRotations,
  lenientVerify,
  type CenterOffender,
} from "../cubeGrid";
import { diffFacelets, validateFacelets, type Face, type Facelet } from "../cubeState";
import { type CellDiag, type FaceFitDiag } from "../accuracy";

export interface FaceSample {
  rgb: RGB[]; // 9 median RGBs, grid order 0..8 (row-major, TL..BR)
  lab: Lab[]; // same, in Lab
  /** Доля пикселей, переживших отбраковку бликов/теней в каждой ячейке (0..1). */
  kept: number[];
  /** Доля пикселей ячейки в гамме кожи (0..1) — палец на грани. */
  skin: number[];
  /** Как легла сетка: выигрыш подгонки, приняли ли её, контраст щелей. */
  fit: FaceFitDiag;
  /** Область, которой грань реально нарезана — чтобы пачка кадров делила одну. */
  region?: FitRegion;
}

/**
 * Read the guide-frame region of `source` as a 3x3 face.
 * `source` is the RAW (un-mirrored) video; `w`,`h` its intrinsic size.
 */
export function readFace(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
  centerFrac: number = config.CELL_CENTER_FRAC,
  /**
   * Эталоны цветов. Если переданы — сетка 3×3 подгоняется под РЕАЛЬНОЕ положение
   * грани внутри рамки (vision/faceFit), а не режется по рамке вслепую. Рамка —
   * это не кубик: держишь ближе/дальше/наискось, и ячейки уезжают на щели и фон.
   */
  refs: Refs | null = null,
  /**
   * Готовая область грани. Передаётся, когда съёмка делается пачкой кадров:
   * кубик за сотню миллисекунд никуда не уходит, а поиск сетки — самая дорогая
   * часть чтения, и повторять его на каждом кадре значит платить за один и тот
   * же ответ пять раз. Пусто — ищем сами.
   */
  presetRegion: FitRegion | null = null,
): FaceSample {
  // Sample a CENTERED SQUARE (side = min of the guide's px dimensions). The 3x3
  // grid below assumes a square cube face fills the region; if the sampled region
  // is wider than tall (guide rect aspect and/or a landscape camera), the left/
  // right sticker COLUMNS fall off the cube onto the background — which is why a
  // solved cube read ~70% wrong at verify while calibration (which only reads the
  // CENTER cell) always worked first try. Forcing a square makes all 9 cells land
  // on the cube like the center one.
  const { gx, gy, gw, gh } = squareGuidePx(guide, w, h);

  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);

  // Куда именно легла грань внутри снятого квадрата. Без эталонов подогнать
  // нечем — режем по рамке, как раньше.
  let ox = 0;
  let oy = 0;
  let side = gw;
  const patch = { data: ctx.getImageData(0, 0, gw, gh).data, size: gw };
  let gain = 0;
  let used = false;
  // Отрыв победителя от несогласного соперника и вердикт «фаза сетки известна».
  // ТЕЛЕМЕТРИЯ: гейт их не читает, поведение чтения от них не зависит (блокер B1
  // плана — путь гейта не трогаем). Но без них живой отчёт не показывал НОВЫЙ
  // структурный признак вовсе, и по прогону нельзя было сказать, сработал он или
  // нет. Печатать число, ради которого чинили, — не машинерия отказа.
  let margin: number | undefined;
  let decided: boolean | undefined;
  if (presetRegion) {
    ox = Math.round(presetRegion.x);
    oy = Math.round(presetRegion.y);
    side = Math.round(presetRegion.side);
    used = true;
  } else if (refs) {
    const fit = fitFaceRegion(patch, refs, centerFrac);
    gain = fit.baselineCost - fit.cost;
    margin = fit.margin;
    decided = fit.decided;
    // Доверяем подгонке только при ощутимом выигрыше: иначе сетка дёргалась бы
    // от кадра к кадру на шуме.
    if (gain >= config.FACE_FIT_MIN_GAIN) {
      used = true;
      ox = Math.round(fit.region.x);
      oy = Math.round(fit.region.y);
      side = Math.round(fit.region.side);
    }
  }
  // Контраст щелей меряется на ТОЙ области, что реально пошла в нарезку, — иначе
  // число описывало бы не то чтение. Признак не требует эталонов, поэтому есть и
  // на калибровочном пути, где подгонки нет.
  const gap = gapContrast(patch, { x: ox, y: oy, side }, centerFrac);
  // Тот же замер для НОВОГО признака — перепада цвета на внутренних границах.
  // На монолитном кубике `gap` уходит в ноль и в минус, и по одному ему нельзя
  // отличить «сетка села верно» от «сетка не нашла ничего».
  // Без третьего аргумента: полоса берётся из конфига, ТА ЖЕ, которой
  // `regionCost` штрафует кандидатов. Раньше сюда уезжал `centerFrac`, и
  // «контраст границ» в отчёте переставал объяснять выбор подгонки.
  const edge = edgeContrast(patch, { x: ox, y: oy, side });

  // Distribute the pixel remainder so the whole fitted square is covered.
  const xEdges = [ox, ox + Math.round(side / 3), ox + Math.round((2 * side) / 3), ox + side];
  const yEdges = [oy, oy + Math.round(side / 3), oy + Math.round((2 * side) / 3), oy + side];

  const rgb: RGB[] = [];
  const lab: Lab[] = [];
  const kept: number[] = [];
  const skin: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = xEdges[col];
      const cy = yEdges[row];
      const cellW = xEdges[col + 1] - cx;
      const cellH = yEdges[row + 1] - cy;
      const data = ctx.getImageData(cx, cy, cellW, cellH).data;
      const cell = robustCellColor(data, cellW, cellH, centerFrac);
      // Тем же окном, что и цвет: палец, попавший в край ячейки, — это соседняя
      // наклейка чужой рукой, а не эта ячейка.
      skin.push(skinFraction(data, cellW, cellH, centerFrac));
      kept.push(cell.kept);
      rgb.push(cell.rgb);
      lab.push(rgb2lab(cell.rgb));
    }
  }
  return {
    rgb,
    lab,
    kept,
    skin,
    fit: { gain, used, gap, edge, margin, decided },
    region: { x: ox, y: oy, side },
  };
}

/** Mean luma (Rec. 601) of the guide region, 0..255. */
export function guideRegionLuma(
  source: CanvasImageSource,
  w: number,
  h: number,
  work: HTMLCanvasElement,
  guide: Rect = config.GUIDE_RECT,
): number {
  const { gx, gy, gw, gh } = squareGuidePx(guide, w, h);
  work.width = gw;
  work.height = gh;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, gx, gy, gw, gh, 0, 0, gw, gh);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  let sum = 0;
  const count = gw * gh;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / count;
}

function argminRef(lab: Lab, refs: Refs): ColorName {
  let best = COLOR_NAMES[0];
  let bestD = Infinity;
  for (const name of COLOR_NAMES) {
    // Метрика ВЫБОРА (ослабленная светлота, colors.deltaEClassify): вопрос
    // «какой из шести», а не «наклейка ли это вообще».
    const d = deltaEClassify(lab, refs[name]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// Shared 6-face resolve (skeptic HIGH#1): compute the RAW per-sticker argmin face
// grids ONCE, then run the legality pipeline (assignFacesByCenter → resolveRotations
// → validate) for the product/verify path. The accuracy harness consumes rawFaceGrids
// directly (it needs the pre-resolve read); verify consumes `resolved`.
type ResolveReason = "assign" | "ambiguous" | "resolve" | "illegal";
interface SixFaceResolve {
  /**
   * СЫРОЕ чтение: независимый argmin по несглаженным цветам, без нормировки и
   * без квот. Это то, что меряет гейт 0.3 — планка по самому зрению, а не по
   * подпоркам поверх него.
   */
  rawFaceGrids: Face[][];
  /**
   * ПРОДУКТОВОЕ чтение: пер-грань нормировка света + квоты 9×6. Именно оно
   * идёт в сверку скрамбла и в сборку кубика.
   */
  productFaceGrids: Face[][];
  /**
   * Какой гранью была каждая съёмка — по СЫРЫМ центрам, одной раскладкой
   * шесть-на-шесть (cubeGrid.assignFacesByCenter). `null`, если раскладка
   * отказала: центр слишком далеко от выданного цвета, то есть грань показали
   * дважды или в рамку попал не кубик. Свободная хватка выравнивается по этому
   * полю: центр — данные, а не подгонка под ответ.
   */
  rawCenterFaces: Face[] | null;
  rawCenterReason?: string;
  /** Какая съёмка провалила замок раскладки: номер, выданный цвет, ΔE до него. */
  rawCenterOffender?: CenterOffender;
  rawCenterOffenders?: CenterOffender[];
  /** Расклад по всем шести: кому какой цвет и на каком расстоянии сидит центр. */
  rawCenterSpread?: {
    faces: Face[];
    des: number[];
    medianDE: number;
    own?: Face[];
    ownDes?: number[];
    rgb?: RGB[];
  };
  resolved: Facelet | null; // legality-resolved URFDLB string, or null on failure
  reason?: ResolveReason; // set iff resolve/validate did not produce a legal cube
}

/**
 * Классификация 54 наклеек с КВОТАМИ 9×6 вместо независимого argmin.
 *
 * На полном чтении шести граней известно жёсткое ограничение: каждого цвета
 * ровно девять, а центры вообще однозначны (центр не двигается). Независимый
 * argmin этим не пользуется — одна пересвеченная белая наклейка спокойно
 * читается как красная, и красных становится десять. Квоты вытесняют наименее
 * уверенное чтение туда, где ещё есть место, и ровно такие одиночные промахи
 * (белая→красная в багрепорте) уходят.
 *
 * Возврат к argmin — только если центры не разложились по шести цветам: тогда
 * пиновать нечего и квоты применять не к чему.
 */
/**
 * Уверенность чтения наклейки: насколько ближайший эталон оторвался от второго.
 * Маленький отрыв — это не чтение, а угадывание: такую грань честнее переспросить.
 */
export function stickerConfidence(
  lab: Lab,
  refs: Refs,
): { best: ColorName; margin: number; d: number } {
  // ДВЕ метрики в одной функции, и это не небрежность.
  //
  // `best` и `margin` отвечают на вопрос «какой из шести и уверенно ли» —
  // метрика выбора с ослабленной светлотой (colors.deltaEClassify), иначе
  // ярко освещённая синяя наклейка «уверенно» окажется белой.
  //
  // `d` отвечает на другой вопрос — «принадлежит ли этот цвет кубику вообще»,
  // и его решает как раз светлота: тёмная щель и серый стол отличаются от
  // наклеек в первую очередь ею. Поэтому `d` считается обычной метрикой, и
  // пороги `STICKER_MAX_DELTA_E` / `FACE_MAX_MEDIAN_DE`, калиброванные на ней,
  // продолжают значить ровно то, что значили.
  let best: ColorName = COLOR_NAMES[0];
  let d1 = Infinity;
  let d2 = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaEClassify(lab, refs[name]);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = name;
    } else if (d < d2) {
      d2 = d;
    }
  }
  return { best, margin: d2 - d1, d: deltaE(lab, refs[best]) };
}

/**
 * Разбор чтения грани для человека: что именно помешало. Без этого «грань не
 * прочиталась» — тупик: непонятно, блик это, тень, съехавшая рамка или два
 * похожих цвета.
 */
export function explainFace(labs: Lab[], refs: Refs, kept: number[]): string {
  const glare: number[] = [];
  const far: number[] = [];
  const ambiguous: string[] = [];
  for (let i = 0; i < labs.length; i++) {
    const { best, margin, d } = stickerConfidence(labs[i], refs);
    if ((kept[i] ?? 1) < config.CELL_MIN_KEPT_FRAC) glare.push(i + 1);
    else if (d > config.STICKER_MAX_DELTA_E) far.push(i + 1);
    else if (margin < config.STICKER_MARGIN_MIN) ambiguous.push(`${i + 1}:${best}?`);
  }
  const parts: string[] = [];
  if (glare.length) parts.push(`блик/тень в ячейках ${glare.join(",")}`);
  if (far.length) parts.push(`ячейки ${far.join(",")} далеко от всех цветов (рамка мимо кубика?)`);
  if (ambiguous.length) parts.push(`спорный цвет: ${ambiguous.join(" ")}`);
  return parts.length ? parts.join("; ") : "цвета читаются, но неустойчиво";
}

/**
 * Медиана ΔE до БЛИЖАЙШЕГО эталона по девяти ячейкам — «похоже ли это вообще на
 * грань кубика».
 *
 * Считать ОБЯЗАТЕЛЬНО по сырым цветам, до normalizeFaceByCenter. Нормировка
 * тянет грань за её собственный центр к эталону того цвета, к которому центр
 * оказался ближе: серый стол едет к белому и превращается в уверенную белую
 * грань 9/9. Именно так живой прогон записал стол как грань U — нормировка не
 * ошиблась, она стёрла улику, а порог уверенности смотрел уже на результат.
 *
 * Отличается от `confidentCells` тем, что меряет: тот спрашивает «различимы ли
 * шесть цветов между собой» (отрыв второго кандидата), этот — «принадлежит ли
 * цвет кубику вообще». Ровный фон проходит первый вопрос и валится на втором.
 */
export function faceMedianDE(labs: Lab[], refs: Refs): number {
  if (labs.length === 0) return 0;
  return median(labs.map((lab) => stickerConfidence(lab, refs).d));
}

/** Сколько ячеек грани прочитаны уверенно (см. config.STICKER_*). */
export function confidentCells(labs: Lab[], refs: Refs, kept: number[]): number {
  let n = 0;
  for (let i = 0; i < labs.length; i++) {
    const { margin, d } = stickerConfidence(labs[i], refs);
    const reliablePixels = (kept[i] ?? 1) >= config.CELL_MIN_KEPT_FRAC;
    if (reliablePixels && margin >= config.STICKER_MARGIN_MIN && d <= config.STICKER_MAX_DELTA_E) {
      n++;
    }
  }
  return n;
}

/**
 * Разбор девяти ячеек на три кучки — почему грань может не читаться.
 *
 * `confidentCells` считает одним числом две РАЗНЫЕ болезни, и лечатся они не
 * одинаково. Ячейка, выбитая бликом или севшая мимо кубика (`kept` мал или ΔE
 * до ближайшего эталона больше `STICKER_MAX_DELTA_E`), — это дырка в данных:
 * цвета там просто нет, и снимать надо заново. Ячейка со СПОРНЫМ цветом
 * (`margin` меньше `STICKER_MARGIN_MIN`) измерена честно, у неё просто два
 * похожих кандидата — красный и оранжевый на дрейфующем автобалансе. Именно
 * ради неё существуют квоты 9×6 и физика поворотов: на полном чтении шести
 * граней у такой ячейки почти всегда остаётся ровно один законный вариант.
 *
 * Живая жалоба 2026-08-24: три отказа подряд «уверенных ячеек 6/9, 7/9, 5/9 —
 * спорный цвет 3:L? 8:R?». Ни одной выбитой, ни одной далёкой — только споры
 * красного с оранжевым, то есть ровно то, что решается ниже по пути. Экран при
 * этом требовал переснять и не давал дойти до места, где спор разрешается.
 */
export function faceReadCounts(
  labs: Lab[],
  refs: Refs,
  kept: number[],
): { bad: number; ambiguous: number; solid: number } {
  let bad = 0;
  let ambiguous = 0;
  for (let i = 0; i < labs.length; i++) {
    const { margin, d } = stickerConfidence(labs[i], refs);
    if ((kept[i] ?? 1) < config.CELL_MIN_KEPT_FRAC || d > config.STICKER_MAX_DELTA_E) bad += 1;
    else if (margin < config.STICKER_MARGIN_MIN) ambiguous += 1;
  }
  return { bad, ambiguous, solid: labs.length - bad - ambiguous };
}

export function classifyWithQuota(
  faces: Lab[][],
  refs: Refs,
  centers: Face[] | null,
  /** Доля выживших пикселей по ячейкам, гранями — в том же порядке, что `faces`. */
  kept?: number[][],
): Face[][] {
  const argminGrids = (): Face[][] =>
    faces.map((grid) => grid.map((lab) => argminRef(lab, refs) as string as Face));
  if (!centers || faces.length !== 6) return argminGrids();

  // Квоты применимы, только пока верна их посылка: заблудилась ОДНА наклейка.
  // Перекос больше — значит сломалась целая грань (сетка заехала на соседнюю,
  // блик выбелил ряд), и девять слотов цвета уже заняты честными ячейками.
  // Тогда раздача не чинит виноватую грань, а ВЫТЕСНЯЕТ верно прочитанные
  // ячейки на других гранях: каждая лишняя наклейка стоит двух ошибок вместо
  // одной. Живые прогоны 2026-08-23 намеряли это дважды — 47/54 и 43/54
  // продуктовых против 50/54 и 49/54 сырых.
  const raw = argminGrids();
  const counts = new Map<string, number>();
  for (const grid of raw) for (const c of grid) counts.set(c, (counts.get(c) ?? 0) + 1);
  let skew = 0;
  for (const name of COLOR_NAMES) {
    skew = Math.max(skew, Math.abs((counts.get(name) ?? 0) - config.QUOTA));
  }
  if (skew > config.QUOTA_MAX_SKEW) return raw;

  const labs: Lab[] = [];
  for (const grid of faces) labs.push(...grid);
  // Ячейка, выбитая бликом, не должна отбирать дефицитный слот у честно
  // измеренной: её мнение о цвете весит меньше (см. colors.cellWeight).
  const weights = kept ? kept.flatMap((grid) => grid.map((k) => cellWeight(k))) : labs.map(() => 1);

  // centerIdx в порядке COLOR_NAMES: индекс центра каждой грани в плоском массиве.
  const centerIdx: number[] = [];
  for (const name of COLOR_NAMES) {
    const cap = centers.indexOf(name as string as Face);
    if (cap < 0) return argminGrids();
    centerIdx.push(cap * 9 + 4);
  }

  const { assignment } = assignQuota(
    labs,
    refs,
    centerIdx,
    config.DELTA_E_MODE,
    config.QUOTA,
    weights,
  );
  const out: Face[][] = [];
  for (let cap = 0; cap < faces.length; cap++) {
    out.push(assignment.slice(cap * 9, cap * 9 + 9) as string[] as Face[]);
  }
  return out;
}

/**
 * Цветовая коррекция всего чтения по шести известным центрам.
 *
 * Центр не двигает ни один ход, поэтому после раскладки съёмок по граням мы
 * знаем шесть пар «наблюдалось → должно быть» — мини-мишень, снятая этим же
 * кадром в этом же свете. По ним считается матрица 3×3 (см.
 * colors.fitColorMatrix) и применяется ко всем 54 ячейкам.
 *
 * Зачем это нужно именно здесь. Ручной баланс белого недоступен на большинстве
 * связок браузер+камера (в частности Chrome на macOS), значит автоматика гуляет
 * МЕЖДУ калибровкой и чтением. Диагональное усиление по белому такой дрейф
 * правит лишь частично: автобаланс меняет смесь каналов, а не только их
 * масштаб.
 *
 * Раскладка не сошлась — коррекции нет. Гадать, какая съёмка какой гранью была,
 * чтобы построить по этой догадке коррекцию, значит чинить цвет предположением
 * о цвете.
 */
function correctByCentres(samples: FaceSample[], refs: Refs, faces: Face[] | null): FaceSample[] {
  if (!faces || faces.length !== samples.length) return samples;
  const observed = samples.map((s) => s.rgb[4]);
  const target = faces.map((f) => lab2rgb(refs[f]));
  const m = fitColorMatrix(observed, target);
  return samples.map((s) => {
    const rgb = s.rgb.map((c) => applyColorMatrix(c, m));
    return { ...s, rgb, lab: rgb.map((c) => rgb2lab(c)) };
  });
}

/** Пер-грань нормировка света по собственному центру каждой снятой грани. */
export function normalizeSamples(samples: FaceSample[], refs: Refs): Lab[][] {
  return samples.map((sample) => {
    const centerName = argminRef(sample.lab[4], refs);
    return normalizeFaceByCenter(sample.rgb, refs[centerName]).map((rgb) => rgb2lab(rgb));
  });
}

function resolveSixFaces(samples: FaceSample[], refs: Refs): SixFaceResolve {
  const rawLabs = samples.map((s) => s.lab);
  const rawFaceGrids: Face[][] = rawLabs.map((grid) =>
    grid.map((lab) => argminRef(lab, refs) as string as Face),
  );
  // Какая съёмка какой гранью была — по СЫРЫМ центрам, раскладкой целиком.
  // Нужно отдельно от продуктового `assign`: тот считается по нормированным
  // цветам, а нормировка тянет грань за её собственный центр к эталону, то есть
  // опознание центра начинает опираться на своё же предположение. Для замера
  // точности выравнивание обязано браться из данных, не из подпорок.
  const rawCenters = assignFacesByCenter(rawLabs, refs);

  // ПРОДУКТОВЫЙ путь: сперва общая цветовая коррекция по шести центрам, потом
  // пер-грань нормировка света. Порядок не переставим: матрица правит смесь
  // каналов (то, что делает автобаланс белого камеры и чего диагональ не умеет),
  // а нормировка добирает разницу освещённости между гранями — тень на одной
  // грани матрица общего вида не видит, она общая на всё чтение.
  //
  // Гейта это НЕ касается: он меряет `rawFaceGrids`, посчитанные выше без
  // единой подпорки. Здесь считается то, что видит человек в соло.
  const corrected = correctByCentres(samples, refs, rawCenters.ok ? rawCenters.faces : null);
  const labs = normalizeSamples(corrected, refs);
  const assign = assignFacesByCenter(labs, refs);
  const productFaceGrids = classifyWithQuota(
    labs,
    refs,
    assign.ok ? assign.faces : null,
    samples.map((s) => s.kept),
  );

  const centres = {
    rawCenterFaces: rawCenters.ok ? rawCenters.faces : null,
    rawCenterReason: rawCenters.ok ? undefined : rawCenters.reason,
    rawCenterOffender: rawCenters.offender,
    rawCenterOffenders: rawCenters.offenders,
    rawCenterSpread: {
      faces: rawCenters.faces,
      des: rawCenters.centerDEs,
      medianDE: rawCenters.medianDE,
      // К чему каждый центр тянется САМ, вне бижекции, и его сырой цвет.
      // Назначенный цвет один этого не показывает: два центра, оба похожие на
      // белый, выглядят в отчёте как «белый» и «оранжевый ΔE 37», и понять,
      // что камера увидела два белых, невозможно.
      own: samples.map((sm) => argminRef(sm.lab[4], refs) as Face),
      ownDes: samples.map((sm) => deltaEClassify(sm.lab[4], refs[argminRef(sm.lab[4], refs)])),
      rgb: samples.map((sm) => sm.rgb[4]),
    },
  };

  if (!assign.ok) {
    return { rawFaceGrids, productFaceGrids, ...centres, resolved: null, reason: "assign" };
  }
  const res = resolveRotations(productFaceGrids, assign.faces);
  if (!res.ok) {
    return {
      rawFaceGrids,
      productFaceGrids,
      ...centres,
      resolved: null,
      reason: res.reason?.includes("ambiguous") ? "ambiguous" : "resolve",
    };
  }
  const read = res.facelets!;
  if (!validateFacelets(read).ok) {
    return { rawFaceGrids, productFaceGrids, ...centres, resolved: read, reason: "illegal" };
  }
  return { rawFaceGrids, productFaceGrids, ...centres, resolved: read };
}

// An accuracy capture outcome (fixed capture order, known ground truth). Drift is
// checked per-face at capture so the tester re-shows a drifted face instead of
// silently measuring calibration error. `complete` carries the raw grids for the
// harness to assemble + score against an INDEPENDENT ground truth.
export type AccuracyCapture =
  | { kind: "pending"; facesLength: number; drifted?: { face: Face; de: number } }
  // luma/refs gate failed или чтение неуверенное. `reason: "not-a-face"` —
  // отдельный случай: сняли не кубик. Он не портит уже снятые грани и лечится
  // одним действием, поэтому вызывающий переспрашивает ЭТУ грань, а не бракует
  // всё чтение.
  | {
      kind: "unreadable";
      diag?: string;
      reason?: "not-a-face" | "no-lattice" | "no-lattice-late" | "wrong-face" | "finger";
    }
  | {
      kind: "complete";
      rawFaceGrids: Face[][]; // 6 × 9 сырое чтение в фиксированном порядке URFDLB
      productFaceGrids: Face[][]; // то же, но продуктовым путём (нормировка + квоты)
      // Какой гранью была каждая съёмка по СЫРЫМ центрам (раскладка целиком), и
      // почему раскладка отказала, если отказала. Свободная хватка берёт
      // выравнивание отсюда.
      rawCenterFaces: Face[] | null;
      rawCenterReason?: string;
      rawCenterOffender?: CenterOffender;
      rawCenterOffenders?: CenterOffender[];
      rawCenterSpread?: {
        faces: Face[];
        des: number[];
        medianDE: number;
        own?: Face[];
        ownDes?: number[];
        rgb?: RGB[];
      };
      cellDiags: CellDiag[]; // 54 записи «почему так прочиталось», тот же порядок
      fitDiags: FaceFitDiag[]; // 6 записей «как легла сетка», тот же порядок
      resolved: Facelet | null; // informational legality-resolve (NOT scored)
      resolveReason?: ResolveReason;
      drifted?: { face: Face; de: number }; // last face drifted > threshold (advisory, not a block)
    };

// Quick-adjust outcome (one white face). `ok` applied a session-local von-Kries
// gain; `wrong-face`/`diverged` leave the seeded refs untouched and the caller
// routes to full 6-face recalibration (skeptic HIGH#3). `unreadable` = light/refs gate.
export type QuickAdjustResult =
  | { kind: "ok" }
  | { kind: "wrong-face"; de: number; nearestColor: ColorName }
  | { kind: "diverged"; reason: "cluster" | "margin" }
  | { kind: "unreadable" };

// A verify capture outcome. `pending` while <6 faces are in; then a terminal.
export type VerifyResult =
  | { kind: "pending"; facesLength: number }
  | { kind: "ok" }
  | { kind: "mismatch"; face: string; count: number }
  | { kind: "illegal" } // read is not a legal cube
  | {
      kind: "unreadable";
      diag?: string;
      reason?: "not-a-face" | "no-lattice" | "no-lattice-late" | "wrong-face" | "finger";
    } // свет/резкость/уверенность/не кубик/нет решётки — diag объясняет что именно
  | { kind: "assign" } // two faces classified to the same center
  | { kind: "ambiguous" } // multiple legal rotations
  | { kind: "resolve" }; // no legal rotation combo

export interface CubeReader {
  readFace: typeof readFace;
  guideRegionLuma: typeof guideRegionLuma;
  calibrationStep: number; // 0..6
  calibrated: boolean;
  seeded: boolean; // refs came from a stored profile (not a fresh 6-face read)
  validated: boolean; // refs passed a full 6-face registration (accuracy-worthy)
  verifyFacesLength: number; // 0..6, of the in-flight collector
  collecting: boolean;
  captureCalibration: (video: HTMLVideoElement) => boolean;
  /**
   * Почему шесть снятых граней отвергнуты целиком. Заполняется вместо `true` на
   * шестом кадре, если по набору читать нельзя (снята не грань, эталоны слиплись);
   * счётчик при этом сбрасывается на 0/6 — набор придётся снять заново.
   */
  calibrationProblem: CalibrationProblem | null;
  /** Seed refs from a stored cube profile (session-local clone). validated=false. */
  seedProfile: (profile: Refs) => void;
  /** One-white-face session white-balance over seeded refs. In-memory only. */
  quickAdjust: (video: HTMLVideoElement) => Promise<QuickAdjustResult>;
  /** The current calibration output (6 Lab face refs, keys U/R/F/D/L/B), or null. */
  getProfile: () => Refs | null;
  recalibrate: () => void;
  beginVerify: () => void;
  pushVerifyFace: (
    video: HTMLVideoElement,
    expected: Facelet,
    tolerant?: boolean,
  ) => Promise<VerifyResult>;
  resetVerify: () => void;
  // Accuracy-harness collector (Stage 0.3): fixed capture order, per-face drift
  // gate, raw grids exposed pre-resolve. Independent of the verify collector.
  accFacesLength: number; // 0..6, of the in-flight accuracy collector
  collectingAccuracy: boolean;
  beginAccuracy: (enforceOrder?: boolean) => void;
  pushAccuracyFace: (video: HTMLVideoElement) => Promise<AccuracyCapture>;
  resetAccuracy: () => void;
}

/**
 * Снять грань по НЕСКОЛЬКИМ кадрам и взять поячеечную медиану.
 *
 * Один кадр — это лотерея: смаз от движения руки, случайный блик, полукадр от
 * rolling shutter. Медиана по пяти кадрам с зазором ~22 мс снимает всё это и
 * стоит около сотни миллисекунд, которых человек не замечает (съёмка идёт по
 * нажатию кнопки, не в цикле).
 */
async function readFaceBurst(
  video: HTMLVideoElement,
  work: HTMLCanvasElement,
  refs: Refs | null,
  frames: number = config.CAPTURE_FRAMES,
  gapMs: number = config.CAPTURE_FRAME_GAP_MS,
): Promise<FaceSample> {
  const shots: FaceSample[] = [];
  // Сетку ищем ОДИН раз, на первом кадре, и держим её для остальных: за сотню
  // миллисекунд кубик не уезжает, а поиск — самая дорогая часть чтения (сотни
  // миллисекунд против единиц). Заодно это убирает дрожь: все кадры пачки
  // нарезаны одной и той же сеткой, а не пятью слегка разными.
  let region: FitRegion | null = null;
  for (let i = 0; i < Math.max(1, frames); i++) {
    const shot = readFace(
      video,
      video.videoWidth,
      video.videoHeight,
      work,
      config.GUIDE_RECT,
      config.CELL_CENTER_FRAC,
      refs,
      region,
    );
    shots.push(shot);
    if (i === 0) region = shot.region ?? null;
    if (i < frames - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  const rgb = medianAcrossFrames(shots.map((s) => s.rgb));
  // Надёжность ячейки — медиана по кадрам: разовый блик не должен ни завалить
  // ячейку, ни притвориться, что всё хорошо.
  const kept = rgb.map((_, i) => median(shots.map((s) => s.kept[i] ?? 0)));
  // Тоже медиана по кадрам: рука дрожит, и один кадр с краем пальца не должен
  // ни забраковать грань, ни спрятать палец, лежащий на ней все пять кадров.
  const skin = rgb.map((_, i) => median(shots.map((s) => s.skin[i] ?? 0)));
  // Телеметрия подгонки — тоже по медиане кадров; `used` берём большинством,
  // чтобы одна дрогнувшая рука не переписала вердикт по всей грани.
  // Телеметрия — от кадра, который ИСКАЛ сетку: остальные её только применяли,
  // и их «выигрыш» ничего не измеряет. Контраст щелей усредняем по кадрам: он
  // считается на своей области каждый раз и от шума страхуется медианой.
  const fit = {
    gain: shots[0].fit.gain,
    gap: median(shots.map((s) => s.fit.gap)),
    edge: median(shots.map((s) => s.fit.edge ?? 0)),
    used: shots[0].fit.used,
    margin: shots[0].fit.margin,
    decided: shots[0].fit.decided,
  };
  return { rgb, lab: rgb.map((c) => rgb2lab(c)), kept, skin, fit };
}

/**
 * «Почему так прочиталось» по всем 54 ячейкам: доля выживших пикселей, ближайший
 * эталон и второй за ним. Считается по тем же сэмплам, что дали сырое чтение, —
 * иначе диагностика описывала бы не то чтение, которое попало в гейт.
 */
function cellDiagnostics(faces: FaceSample[], refs: Refs): CellDiag[] {
  const out: CellDiag[] = [];
  // Самый светлый эталон, а не `refs.U`: белый — это тот, что снялся светлее
  // всех (это и проверяет colors.checkCalibration), и брать его по имени грани
  // значило бы верить имени там, где есть измерение.
  const whiteL = Math.max(...COLOR_NAMES.map((name) => refs[name][0]));
  for (const face of faces) {
    for (let c = 0; c < 9; c++) {
      // Той же метрикой, что и решение: диагностика, посчитанная другой,
      // печатала бы «прочитано U, а ближайший B» — ровно то враньё, из-за
      // которого её однажды уже чинили.
      const ranked = COLOR_NAMES.map((name) => ({
        name: name as string,
        de: deltaEClassify(face.lab[c], refs[name]),
      })).sort((a, b) => a.de - b.de);
      const [r, g, b] = face.rgb[c];
      out.push({
        rgb: [r, g, b],
        kept: face.kept[c] ?? 0,
        best: ranked[0].name,
        bestDE: ranked[0].de,
        second: ranked[1].name,
        secondDE: ranked[1].de,
        skin: face.skin[c] ?? 0,
        lift: face.lab[c][0] - whiteL,
        chroma: chroma(face.lab[c]),
      });
    }
  }
  return out;
}

/** Stateful reader bound to a work-canvas ref. */
export function useCubeReader(workRef: React.RefObject<HTMLCanvasElement | null>): CubeReader {
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [seeded, setSeeded] = useState(false);
  const [validated, setValidated] = useState(false);
  const [verifyFacesLength, setVerifyFacesLength] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [accFacesLength, setAccFacesLength] = useState(0);
  const [collectingAccuracy, setCollectingAccuracy] = useState(false);
  // Почему последний набор из шести граней отвергнут (null — претензий нет).
  const [calibrationProblem, setCalibrationProblem] = useState<CalibrationProblem | null>(null);
  const refsRef = useRef<Refs | null>(null);
  const calibRgbRef = useRef<Partial<Record<ColorName, RGB>>>({});
  const collectorRef = useRef<FaceSample[] | null>(null);
  const accCollectorRef = useRef<FaceSample[] | null>(null);
  // Какие грани уже забракованы замком решётки в ТЕКУЩЕМ чтении. Бюджет — одна
  // пересъёмка на грань: у грани, где рядом лежат наклейки одного цвета, оба
  // признака решётки законно слабые, и бесконечный отказ превратил бы харнесс в
  // тупик. Один раз просим переснять, второй — принимаем как есть.
  const latticeRefusedRef = useRef<Set<number>>(new Set());
  // Требовать ли порядок граней U R F D L B. Только строгая хватка его задаёт;
  // в свободной и «по картинке» человек показывает грани как удобно, и
  // требовать там порядок значило бы мерить память, а не зрение.
  const enforceOrderRef = useRef(false);
  // Сколько раз подряд грань отклонена по неуверенности (см. пороги в config).
  const lowConfidenceRef = useRef(0);

  const readable = (video: HTMLVideoElement, work: HTMLCanvasElement): boolean => {
    if (!refsRef.current) return false;
    const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
    return luma >= config.MIN_FRAME_LUMA && luma <= config.MAX_FRAME_LUMA;
  };

  // Returns false when the guide region isn't a plausible frame to sample (too
  // dark / blown-out — the SAME luma gate `readable()` applies to quick-adjust
  // and verify, minus its refs precondition, which don't exist yet mid-6-face
  // build). This stops an empty/black frame from being captured as a "face" and
  // silently poisoning the profile (the "снял без кубика → готово" bug). Note:
  // the luma gate cannot distinguish a solved face from a well-lit empty surface
  // — that deeper presence check is the R1 vision work (see /accuracy).
  const captureCalibration = (video: HTMLVideoElement): boolean => {
    const work = workRef.current;
    if (!work) return false;
    const luma = guideRegionLuma(video, video.videoWidth, video.videoHeight, work);
    if (luma < config.MIN_FRAME_LUMA || luma > config.MAX_FRAME_LUMA) return false;
    let step = calibrationStep;
    if (step >= COLOR_NAMES.length) {
      step = 0;
      calibRgbRef.current = {};
      refsRef.current = null;
    }
    const face = readFace(video, video.videoWidth, video.videoHeight, work);
    calibRgbRef.current[COLOR_NAMES[step]] = face.rgb[4]; // center sticker
    const next = step + 1;
    if (next >= COLOR_NAMES.length) {
      // A full 6-face registration → accuracy-worthy refs (skeptic HIGH#4).
      // Faces are collected into slots by capture order, but LABELLED by their
      // actual colour (min-cost bijection to the canonical anchors), so the user
      // may show the 6 solved faces in any order without mislabelling the refs.
      const captured = COLOR_NAMES.map((n) => calibRgbRef.current[n]!);
      const refs = calibrateByColorIdentity(captured);
      // Раскладка по цветам не умеет отказывать — она раздаёт слоты ближайшим,
      // даже если один «цвет» снят с руки или со стола. Проверяем набор целиком и
      // выбрасываем его весь: половина набора негодна так же, как весь.
      const problem = checkCalibration(refs);
      if (problem) {
        calibRgbRef.current = {};
        refsRef.current = null;
        setCalibrationProblem(problem);
        setSeeded(false);
        setValidated(false);
        setCalibrationStep(0);
        return false;
      }
      refsRef.current = refs;
      setCalibrationProblem(null);
      setSeeded(false);
      setValidated(true);
    }
    setCalibrationStep(next);
    return true;
  };

  // Seed from a stored profile: clone so quick-adjust mutates a session-local copy,
  // never the stored profile. seeded=true, validated=false — one white face cannot
  // validate red/orange separability, so this path stays casual-only (skeptic HIGH#4).
  const seedProfile = (profile: Refs): void => {
    const clone = {} as Refs;
    for (const name of COLOR_NAMES) clone[name] = [...profile[name]] as Lab;
    refsRef.current = clone;
    calibRgbRef.current = {};
    setSeeded(true);
    setValidated(false);
    setCalibrationStep(COLOR_NAMES.length); // fully "calibrated" (6/6) from the profile
    resetVerify();
  };

  // One white face → von-Kries session white-balance. STRICTLY in-memory: never
  // calls the cubes API / PATCH color_profile (skeptic constraint #4).
  const quickAdjust = async (video: HTMLVideoElement): Promise<QuickAdjustResult> => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };
    const face = await readFaceBurst(video, work, refs);
    const decision = colorsQuickAdjust(refs, face.rgb);
    switch (decision.kind) {
      case "ok":
        refsRef.current = decision.refs; // session-local mutation only
        return { kind: "ok" };
      case "wrong-face":
        return { kind: "wrong-face", de: decision.nearestDE, nearestColor: decision.nearestColor };
      case "diverged":
        return { kind: "diverged", reason: decision.reason };
    }
  };

  const recalibrate = (): void => {
    calibRgbRef.current = {};
    refsRef.current = null;
    setSeeded(false);
    setValidated(false);
    setCalibrationStep(0);
    setCalibrationProblem(null);
    resetVerify();
  };

  const beginVerify = (): void => {
    collectorRef.current = [];
    setVerifyFacesLength(0);
    setCollecting(true);
  };

  const resetVerify = (): void => {
    collectorRef.current = null;
    setVerifyFacesLength(0);
    setCollecting(false);
  };

  const pushVerifyFace = async (
    video: HTMLVideoElement,
    expected: Facelet,
    tolerant = false,
  ): Promise<VerifyResult> => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs || !collectorRef.current) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };

    // Эталоны передаются, значит сетка подгоняется под грань в кадре
    // (см. faceFit): это геометрия чтения, а не подпорка поверх цвета,
    // поэтому применяется и в гейте точности тоже.
    const face = await readFaceBurst(video, work, refs);

    // Первым делом — «а кубик ли это». Замок безусловный и без счётчика попыток,
    // в отличие от порога уверенности ниже: там камера говорит «не уверена» и
    // человеку нечего с этим сделать, поэтому после нескольких отказов грань
    // принимается; здесь ему есть что сделать — навести рамку на кубик, — и
    // молчаливый приём фона отравил бы чтение целиком.
    const medianDE = faceMedianDE(face.lab, refs);
    if (medianDE > config.FACE_MAX_MEDIAN_DE) {
      return { kind: "unreadable", diag: notACubeFaceRu(medianDE), reason: "not-a-face" };
    }

    // Пер-грань нормировка света по своему центру + порог уверенности. Грань,
    // прочитанную наугад (мало отрыва до второго цвета, блик съел ячейку),
    // честнее переспросить — но не бесконечно: после
    // FACE_CONFIDENCE_RETRIES отказов подряд принимаем как есть, иначе человек
    // запирается на экране, где камера говорит «не уверена», а сделать нечего.
    const centerName = argminRef(face.lab[4], refs);
    const fixedRGB = normalizeFaceByCenter(face.rgb, refs[centerName]);
    const fixedLab = fixedRGB.map((rgb) => rgb2lab(rgb));
    // Дырки в данных и споры о цвете считаются раздельно: первые лечатся
    // пересъёмкой, вторые — квотами и физикой ниже по пути (faceReadCounts).
    const counts = faceReadCounts(fixedLab, refs, face.kept);
    const confident = counts.solid + counts.ambiguous;
    if (
      confident < config.FACE_MIN_CONFIDENT_CELLS ||
      counts.ambiguous > config.FACE_MAX_AMBIGUOUS_CELLS
    ) {
      lowConfidenceRef.current += 1;
      if (lowConfidenceRef.current <= config.FACE_CONFIDENCE_RETRIES) {
        return {
          kind: "unreadable",
          diag: `уверенных ячеек ${confident}/9 — ${explainFace(fixedLab, refs, face.kept)}`,
        };
      }
    }
    lowConfidenceRef.current = 0;

    // Кладём СЫРОЙ сэмпл: нормировка и квоты применяются одним местом ниже
    // (resolveSixFaces), чтобы харнесс точности мог отдельно посмотреть сырое
    // чтение и продуктовое.
    collectorRef.current.push(face);
    const n = collectorRef.current.length;
    setVerifyFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n };

    // 6 faces in. Assign each to a face by its center color, then resolve rotations.
    const faces = collectorRef.current;
    collectorRef.current = null;
    setCollecting(false);
    setVerifyFacesLength(0);

    const { productFaceGrids, resolved, reason } = resolveSixFaces(faces, refs);

    // Casual solo (tolerant): don't demand a globally-legal cube. Score the real
    // per-sticker read against `expected` face-by-face and accept within tolerance,
    // so one colour misread doesn't nuke the whole 6-face read (R1). Only OK or
    // MISMATCH ever come back here — never unreadable/assign/ambiguous/resolve.
    // Ranked (Stage 4) uses the strict path below (tolerant=false).
    if (tolerant) {
      const centers = assignFacesByCenter(normalizeSamples(faces, refs), refs).faces;
      const lm = lenientVerify(productFaceGrids, centers, expected);
      const correctFrac = (lm.totalStickers - lm.mismatches) / lm.totalStickers;
      if (correctFrac >= config.CASUAL_VERIFY_MIN_CORRECT_FRAC) return { kind: "ok" };
      return { kind: "mismatch", face: lm.worstFace, count: lm.mismatches };
    }

    if (reason === "assign") return { kind: "assign" };
    if (reason === "ambiguous") return { kind: "ambiguous" };
    if (reason === "resolve") return { kind: "resolve" };
    if (reason === "illegal") return { kind: "illegal" };
    const read = resolved!;
    const diffs = diffFacelets(read, expected);
    if (diffs.length === 0) return { kind: "ok" };
    return { kind: "mismatch", face: diffs[0].face, count: diffs.length };
  };

  // ---- Accuracy collector (fixed capture order URFDLB) ----------------------

  const beginAccuracy = (enforceOrder = false): void => {
    accCollectorRef.current = [];
    latticeRefusedRef.current = new Set();
    enforceOrderRef.current = enforceOrder;
    setAccFacesLength(0);
    setCollectingAccuracy(true);
  };

  const resetAccuracy = (): void => {
    accCollectorRef.current = null;
    latticeRefusedRef.current = new Set();
    setAccFacesLength(0);
    setCollectingAccuracy(false);
  };

  const pushAccuracyFace = async (video: HTMLVideoElement): Promise<AccuracyCapture> => {
    const work = workRef.current;
    const refs = refsRef.current;
    if (!work || !refs || !accCollectorRef.current) return { kind: "unreadable" };
    if (!readable(video, work)) return { kind: "unreadable" };

    // Fixed order: the i-th captured face IS COLOR_NAMES[i] (== FACE_ORDER[i]).
    // Enforce CENTER_DRIFT_DE against that known ref so we re-show a drifted face
    // instead of measuring calibration drift as a vision error (skeptic MED).
    const faceIndex = accCollectorRef.current.length;
    const expectedColor = COLOR_NAMES[faceIndex];
    const face = await readFaceBurst(video, work, refs);

    // Тот же безусловный замок, что и в продуктовом пути. Здесь он важнее вдвое:
    // харнесс скорит СЫРОЕ чтение, и снятый вместо грани стол уходит прямо в
    // числа гейта — девять ячеек фона выглядят как девять ошибок зрения, хотя
    // зрение их не делало. Отказ = дроп с причиной, дропы учтены протоколом.
    const medianDE = faceMedianDE(face.lab, refs);
    if (medianDE > config.FACE_MAX_MEDIAN_DE) {
      return { kind: "unreadable", diag: notACubeFaceRu(medianDE), reason: "not-a-face" };
    }

    // Палец на грани. Проверяется РАНЬШЕ решётки и центра: закрытая наклейка
    // портит и то, и другое, и сообщать надо о причине, а не о следствии.
    const fingers = face.skin
      .map((f, i) => ({ i, f }))
      .filter((c) => c.f > config.CELL_SKIN_FRAC_MAX);
    if (fingers.length > 0) {
      const worst = fingers.reduce((a, b) => (b.f > a.f ? b : a));
      return {
        kind: "unreadable",
        reason: "finger",
        diag: fingerOnFaceRu(fingers.length, worst.f * 100),
      };
    }

    // Решётка этой съёмки против решётки уже снятых граней. Цветовые замки выше
    // сюда не достают: белый стол за краем рамки — законный цвет кубика, и по
    // ΔE такая съёмка выглядит здоровой. Мимо грани выдаёт структура.
    const lattice = latticeVerdict(
      face.fit,
      accCollectorRef.current.map((f) => f.fit),
    );
    if (lattice.collapsed && !latticeRefusedRef.current.has(faceIndex)) {
      latticeRefusedRef.current.add(faceIndex);
      return {
        kind: "unreadable",
        reason: "no-lattice",
        diag: latticeCollapsedRu(
          expectedColor,
          face.fit.edge ?? 0,
          lattice.edgeMedian,
          face.fit.gap,
          lattice.gapMedian,
        ),
      };
    }

    const de = deltaE(face.lab[4], refs[expectedColor]);
    // Показали не ту грань — при строгой хватке это отказ, а не замечание.
    //
    // Отличаем от уехавшего света по направлению, а не по величине: свет уводит
    // центр далеко от ВСЕХ эталонов сразу, чужая грань садится ТОЧНО на другой.
    // Поэтому мало «далеко от ожидаемого» — нужно ещё «уверенно близко к
    // чужому», иначе отказ начнёт срабатывать на дрейфе, ради терпимости к
    // которому проверку и сделали совещательной.
    const own = argminRef(face.lab[4], refs);
    const ownDE = deltaE(face.lab[4], refs[own]);
    if (
      enforceOrderRef.current &&
      own !== expectedColor &&
      de > config.CENTER_OUTLIER_DE &&
      ownDE * 2 < de
    ) {
      return {
        kind: "unreadable",
        reason: "wrong-face",
        diag: wrongFaceRu(expectedColor, own, faceIndex + 1, de, ownDE),
      };
    }
    // Drift is ADVISORY, not a block: on a real webcam the center can legitimately
    // drift > CENTER_DRIFT_DE (auto-WB/exposure) and refusing the capture just stops
    // any data from ever being collected. Capture the face anyway and surface the
    // drift as a warning so the read completes and the report quantifies the real
    // per-sticker accuracy (that IS the diagnostic we need).
    const drifted =
      de > config.CENTER_DRIFT_DE ? { face: expectedColor as string as Face, de } : undefined;

    accCollectorRef.current.push(face);
    const n = accCollectorRef.current.length;
    setAccFacesLength(n);
    if (n < 6) return { kind: "pending", facesLength: n, drifted };

    const faces = accCollectorRef.current;
    accCollectorRef.current = null;
    setCollectingAccuracy(false);
    setAccFacesLength(0);

    // Первые съёмки проверить в момент захвата было не с чем — медианы ещё не
    // существовало. Теперь она есть: сверяем каждую грань со всеми остальными.
    // Переснять одну грань уже поздно, поэтому чтение уходит в дроп целиком —
    // это честнее, чем засчитать в гейт девять ячеек стола.
    const collapsed = faces
      .map((f, i) => ({
        i,
        v: latticeVerdict(
          f.fit,
          faces.filter((_, j) => j !== i).map((o) => o.fit),
        ),
      }))
      .filter((x) => x.v.collapsed);
    if (collapsed.length > 0) {
      return {
        kind: "unreadable",
        // Своя причина, а не общая: отказ УЖЕ объясняет, что делать («сними
        // чтение заново»), и обёртка «повтори грань, держи её в жёлтой рамке»
        // поверх него говорит человеку противоположное.
        reason: "no-lattice-late",
        diag: latticeCollapsedLateRu(collapsed.map((x) => String(COLOR_NAMES[x.i]))),
      };
    }

    const {
      rawFaceGrids,
      productFaceGrids,
      rawCenterFaces,
      rawCenterReason,
      rawCenterOffender,
      rawCenterOffenders,
      rawCenterSpread,
      resolved,
      reason,
    } = resolveSixFaces(faces, refs);
    return {
      kind: "complete",
      rawFaceGrids,
      productFaceGrids,
      rawCenterFaces,
      rawCenterReason,
      rawCenterOffender,
      rawCenterOffenders,
      rawCenterSpread,
      cellDiags: cellDiagnostics(faces, refs),
      fitDiags: faces.map((f) => f.fit),
      resolved,
      resolveReason: reason,
      drifted,
    };
  };

  return {
    readFace,
    guideRegionLuma,
    calibrationStep,
    calibrated: refsRef.current !== null,
    seeded,
    validated,
    verifyFacesLength,
    collecting,
    captureCalibration,
    calibrationProblem,
    seedProfile,
    quickAdjust,
    getProfile: () => refsRef.current,
    recalibrate,
    beginVerify,
    pushVerifyFace,
    resetVerify,
    accFacesLength,
    collectingAccuracy,
    beginAccuracy,
    pushAccuracyFace,
    resetAccuracy,
  };
}
