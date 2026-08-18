// Подгонка сетки 3×3 под РЕАЛЬНОЕ положение грани в кадре.
//
// Зачем: раньше 3×3 нарезалось по жёлтой рамке, а рамка — это не кубик. Держишь
// чуть ближе, дальше или наискось — ячейки съезжают на щели между наклейками и
// на фон. Именно так белая наклейка читалась как красная: медиана бралась
// наполовину с чёрной щели и наполовину с наклейки соседнего цвета.
//
// Как: вместо распознавания контуров перебираем небольшой набор кандидатов
// (масштаб × сдвиг) и берём тот, чья сетка ЛУЧШЕ ВСЕГО ложится на наклейки.
// Оценка кандидата — не «похоже на квадрат», а прямо то, что нам нужно:
//   • каждая ячейка близка к одному из шести эталонов (фон и щели далеки);
//   • внутри ячейки цвет однороден (щель между наклейками даёт разброс);
//   • на границах ячеек есть тёмные щели — грань устроена как решётка.
// Поиск идёт по ОДНОМУ снятому патчу в памяти, без повторных draw — это десятки
// тысяч арифметических операций, доли миллисекунды.
//
// Про третий признак. Первых двух не хватает: «похожа на какой-нибудь эталон» —
// это ровно то, чем светлый фон (стол, стена, засвеченное окно) неотличим от
// белой наклейки. На живом кадре в кафе сетка спокойно съезжала вниз с кубика,
// нижний ряд читался как U, а стоимость кандидата оставалась низкой — подгонка
// считала такое положение отличным. Щели штрафовались, но только когда сетка
// села НА них; за то, что щели пришлись НА границы ячеек, никто не награждал.
// Решётка — признак самого кубика: у однотонной поверхности её нет ни при каком
// масштабе, поэтому фон дороже грани независимо от того, какого он цвета.

import { config } from "./config";
import { deltaE, median, rgb2lab, COLOR_NAMES, type Refs, type RGB } from "./colors";

export interface FitRegion {
  /** Левый верхний угол и сторона квадрата в координатах патча. */
  x: number;
  y: number;
  side: number;
}

export interface FitResult {
  region: FitRegion;
  /** Оценка выбранного кандидата (меньше — лучше). */
  cost: number;
  /** Оценка исходной (рамочной) области — для сравнения «стало/было». */
  baselineCost: number;
  /**
   * Отрыв от ближайшего НЕСОГЛАСНОГО соперника в окрестности победителя
   * (см. {@link fitFaceRegion}), в тех же единицах, что и `cost`. `Infinity`,
   * если такого соперника не нашлось. ТЕЛЕМЕТРИЯ: на выбор `region` не влияет.
   */
  margin: number;
  /** `margin >= FACE_FIT_MIN_MARGIN`. ТЕЛЕМЕТРИЯ: не гейт, только отчёт. */
  decided: boolean;
}

/** Патч: RGBA-пиксели квадратной области кадра. */
export interface Patch {
  data: Uint8ClampedArray | number[];
  size: number;
}

/**
 * Шаг прореживания, дающий примерно `target` отсчётов вдоль стороны.
 *
 * Медиане цвета ячейки не нужны все её пиксели: две-три сотни отсчётов дают ту же
 * медиану, что двадцать тысяч, а перебор кандидатов на полном разрешении стоил
 * 3.2 секунды на грань — при пяти кадрах на съёмку это шестнадцать секунд, то
 * есть инструмент, которым нельзя снять двадцать чтений.
 */
function strideFor(span: number, target: number): number {
  return Math.max(1, Math.floor(span / target));
}

function cellStats(
  patch: Patch,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  centerFrac: number,
  samples = 0,
): { rgb: RGB; spread: number } {
  const mx = Math.floor((cw * (1 - centerFrac)) / 2);
  const my = Math.floor((ch * (1 - centerFrac)) / 2);
  const sx = samples > 0 ? strideFor(cw - 2 * mx, samples) : 1;
  const sy = samples > 0 ? strideFor(ch - 2 * my, samples) : 1;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lumas: number[] = [];
  for (let y = y0 + my; y < y0 + ch - my; y += sy) {
    if (y < 0 || y >= patch.size) continue;
    for (let x = x0 + mx; x < x0 + cw - mx; x += sx) {
      if (x < 0 || x >= patch.size) continue;
      const i = (y * patch.size + x) * 4;
      const r = patch.data[i];
      const g = patch.data[i + 1];
      const b = patch.data[i + 2];
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  if (rs.length === 0) return { rgb: [0, 0, 0], spread: 255 };
  const medL = median(lumas);
  // Разброс — средний модуль отклонения яркости: щель между наклейками и край
  // кубика дают заметный разброс, ровная наклейка почти нулевой.
  let dev = 0;
  for (const l of lumas) dev += Math.abs(l - medL);
  return { rgb: [median(rs), median(gs), median(bs)], spread: dev / lumas.length };
}

const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Насколько ОДНА ячейка окантована тёмным, в единицах яркости 0..255.
 *
 * Признак поячеечный, а не на всю область, и это принципиально. Область целиком
 * ловит только грубые промахи: сетку на ровной поверхности и сдвиг на половину
 * ячейки. А живой отказ выглядел иначе — сетка съехала на ЦЕЛУЮ ячейку вниз, два
 * ряда остались на кубике, нижний ушёл на стол. Решётка при таком сдвиге не
 * ломается (щели совпали со следующими щелями), и признак на всю область такое
 * пропускает. Поячеечный — нет: ячейке на столе окантовки взять негде.
 *
 * Считается так: медиана яркости по каждой из четырёх полос, затем ВТОРАЯ С КОНЦА
 * из четырёх (не среднее и не худшая). Среднее не годится — ячейка на столе
 * вплотную к кубику получает одну тёмную полосу от его ребра, среднее уезжает
 * вниз, и ячейка выглядит окантованной. Худшая не годится в другую сторону: один
 * блик в щели зарубил бы правильную ячейку. Вторая с конца требует, чтобы тёмными
 * были минимум три стороны из четырёх.
 */
function cellGapContrast(
  patch: Patch,
  x0: number,
  y0: number,
  w: number,
  h: number,
  cellLuma: number,
  bandFrac: number,
  samples = 0,
): number {
  const halfW = Math.max(1, Math.round((w * bandFrac) / 2));
  const halfH = Math.max(1, Math.round((h * bandFrac) / 2));

  const bandMedian = (bx: number, by: number, bw: number, bh: number): number | null => {
    const lumas: number[] = [];
    // Полоса узкая и длинная: вдоль неё нужен размах, поперёк хватает трёх
    // отсчётов. Одинаковый шаг по обеим осям делал полосы дороже самих ячеек —
    // тонкая сторона не прореживалась вовсе.
    const sx = samples > 0 ? strideFor(bw, bw >= bh ? samples : 3) : 1;
    const sy = samples > 0 ? strideFor(bh, bh > bw ? samples : 3) : 1;
    for (let y = by; y < by + bh; y += sy) {
      if (y < 0 || y >= patch.size) continue;
      for (let x = bx; x < bx + bw; x += sx) {
        if (x < 0 || x >= patch.size) continue;
        const i = (y * patch.size + x) * 4;
        lumas.push(luma([patch.data[i], patch.data[i + 1], patch.data[i + 2]]));
      }
    }
    return lumas.length === 0 ? null : median(lumas);
  };

  const bands = [
    bandMedian(x0, y0 - halfH, w, 2 * halfH), // сверху
    bandMedian(x0, y0 + h - halfH, w, 2 * halfH), // снизу
    bandMedian(x0 - halfW, y0, 2 * halfW, h), // слева
    bandMedian(x0 + w - halfW, y0, 2 * halfW, h), // справа
  ].filter((v): v is number => v !== null);
  if (bands.length === 0) return 0;

  bands.sort((a, b) => a - b);
  return cellLuma - bands[Math.min(2, bands.length - 1)];
}

/**
 * Медианный ЦВЕТ узкой полосы патча — тот же принцип прореживания, что у
 * {@link cellGapContrast}, но полоса отдаёт RGB, а не яркость: контраст щели
 * ищет тёмный корпус кубика (яркость), а контраст границы ищет РАЗНЫЙ ЦВЕТ
 * двух соседних наклеек, которого на stickerless-кубике без корпуса между
 * ними никакая яркость не увидит.
 */
function bandColorMedian(
  patch: Patch,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  samples = 0,
): RGB | null {
  const sx = samples > 0 ? strideFor(bw, bw >= bh ? samples : 3) : 1;
  const sy = samples > 0 ? strideFor(bh, bh > bw ? samples : 3) : 1;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = by; y < by + bh; y += sy) {
    if (y < 0 || y >= patch.size) continue;
    for (let x = bx; x < bx + bw; x += sx) {
      if (x < 0 || x >= patch.size) continue;
      const i = (y * patch.size + x) * 4;
      rs.push(patch.data[i]);
      gs.push(patch.data[i + 1]);
      bs.push(patch.data[i + 2]);
    }
  }
  return rs.length === 0 ? null : [median(rs), median(gs), median(bs)];
}

/**
 * Насколько ОДНА ячейка отличается ЦВЕТОМ от своих соседей через ВНУТРЕННИЕ
 * границы сетки (со стороной грани — периметр — не считается ВООБЩЕ).
 *
 * Зачем отдельно от `cellGapContrast`. У stickerless-кубика между наклейками
 * нет тёмного корпуса — только едва заметная тень или вообще ничего, поэтому
 * контраст щели там равен нулю на любой фазе сетки, выровненной или нет:
 * признак немой. Но ЦВЕТ по разные стороны настоящей границы двух наклеек
 * почти всегда разный (кроме двух одноцветных соседей), а сетка, съехавшая на
 * целую ячейку, меряет цвет не поперёк границы, а ВНУТРИ одной наклейки — там
 * разницы нет. Это и есть сигнал фазы, которого не даёт контраст щели.
 *
 * Почему периметр исключён (это НЕ то же самое отличие, что у `cellGapContrast`,
 * который periметр не исключает). Периметр грани — это граница «грань/фон»:
 * контраст там огромен при ЛЮБОЙ фазе сетки (сдвинутая на ячейку сетка всё
 * равно смотрит на фон с одной стороны), и признак фазы держался бы всего на
 * одной центральной ячейке из девяти. Внутренние границы так не подделать:
 * обе стороны — это ткань самого кубика.
 *
 * Полосы смещены ВГЛУБЬ от шва на `bandFrac/2` ячейки в каждую сторону, а не
 * садятся на сам шов: на шве может быть блик, тень или остаток физического
 * зазора, и его цвет — не цвет ни одной из двух наклеек.
 *
 * Статистика — как у `cellGapContrast`, тем же приёмом (см. комментарий там):
 * не среднее (один блик на одной стороне тянет вниз ВСЮ ячейку) и не худшая
 * (одна совпадающая по цвету пара соседей — например, два белых — обнулила бы
 * ячейку, у которой остальные стороны прекрасно контрастны). Берём ВТОРОЕ
 * значение от начала отсортированного по возрастанию списка: это «худшая из
 * оставшихся после того, как одну (любую) сторону простили». Прощаем ровно
 * одну, потому что измерено: `MAX` (берём лучшую из четырёх) не различает
 * выровненную сетку и сдвинутую на целую ячейку — обе давали deficit 0.00,
 * потому что хватало одной случайно контрастной стороны из четырёх
 * (`swarm-report/stickerless-face-fit-plan.md`, шаг 0).
 */
function cellEdgeContrast(
  patch: Patch,
  x0: number,
  y0: number,
  w: number,
  h: number,
  hasTop: boolean,
  hasBottom: boolean,
  hasLeft: boolean,
  hasRight: boolean,
  bandFrac: number,
  samples = 0,
): number {
  const halfW = Math.max(1, Math.round((w * bandFrac) / 2));
  const halfH = Math.max(1, Math.round((h * bandFrac) / 2));

  const sideContrast = (inner: RGB | null, outer: RGB | null): number | null =>
    inner === null || outer === null ? null : deltaE(rgb2lab(inner), rgb2lab(outer));

  const values: number[] = [];
  if (hasTop) {
    const inner = bandColorMedian(patch, x0, y0 + halfH, w, 2 * halfH, samples);
    const outer = bandColorMedian(patch, x0, y0 - 3 * halfH, w, 2 * halfH, samples);
    const v = sideContrast(inner, outer);
    if (v !== null) values.push(v);
  }
  if (hasBottom) {
    const inner = bandColorMedian(patch, x0, y0 + h - 3 * halfH, w, 2 * halfH, samples);
    const outer = bandColorMedian(patch, x0, y0 + h + halfH, w, 2 * halfH, samples);
    const v = sideContrast(inner, outer);
    if (v !== null) values.push(v);
  }
  if (hasLeft) {
    const inner = bandColorMedian(patch, x0 + halfW, y0, 2 * halfW, h, samples);
    const outer = bandColorMedian(patch, x0 - 3 * halfW, y0, 2 * halfW, h, samples);
    const v = sideContrast(inner, outer);
    if (v !== null) values.push(v);
  }
  if (hasRight) {
    const inner = bandColorMedian(patch, x0 + w - 3 * halfW, y0, 2 * halfW, h, samples);
    const outer = bandColorMedian(patch, x0 + w + halfW, y0, 2 * halfW, h, samples);
    const v = sideContrast(inner, outer);
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(1, values.length - 1)];
}

/**
 * Средний по 9 ячейкам контраст окантовки — диагностическая свёртка того же
 * признака, которым штрафуется кандидат в regionCost.
 */
export function gapContrast(
  patch: Patch,
  region: FitRegion,
  centerFrac = 0.5,
  bandFrac: number = config.FACE_FIT_GAP_BAND_FRAC,
): number {
  const cw = region.side / 3;
  let total = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      const cl = luma(cellStats(patch, x0, y0, w, h, centerFrac).rgb);
      total += cellGapContrast(patch, x0, y0, w, h, cl, bandFrac);
    }
  }
  return total / 9;
}

/**
 * Средний по 9 ячейкам контраст границ — диагностическая свёртка-близнец
 * `gapContrast`, только для stickerless-признака (цвет через внутреннюю
 * границу, а не яркость щели). Для отчёта: живые числа, а не декларация.
 */
export function edgeContrast(
  patch: Patch,
  region: FitRegion,
  bandFrac: number = config.FACE_FIT_GAP_BAND_FRAC,
): number {
  const cw = region.side / 3;
  let total = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      total += cellEdgeContrast(patch, x0, y0, w, h, row > 0, row < 2, col > 0, col < 2, bandFrac);
    }
  }
  return total / 9;
}

/** Стоимость кандидата: чем меньше, тем лучше сетка легла на наклейки. */
export function regionCost(
  patch: Patch,
  region: FitRegion,
  refs: Refs,
  centerFrac = 0.5,
  gapTarget: number = config.FACE_FIT_GAP_TARGET,
  gapWeight: number = config.FACE_FIT_GAP_WEIGHT,
  bandFrac: number = config.FACE_FIT_GAP_BAND_FRAC,
  /** Сколько отсчётов вдоль стороны ячейки брать; 0 — все пиксели. */
  samples = 0,
  // Признак границ (см. cellEdgeContrast) для stickerless-кубика — щели у
  // которого нет. НЕЗАВИСИМОЕ слагаемое, а не max(gapC, edgeC*k): max умеет
  // только СНИЖАТЬ штраф (он берёт лучшее из двух), а значит ослабляет
  // структурный сигнал ВЕЗДЕ, включая стикерный путь — измерено, marginWith
  // проседал с 4.97 до 1.12 при тесте, требующем > 3.00 (faceFit.test.ts).
  // EDGE_WEIGHT стартует с нуля (config.ts): «стикерный не изменился» —
  // доказанное тождество (тест ниже), а не расчёт на то, что слагаемое мало.
  edgeTarget: number = config.FACE_FIT_EDGE_TARGET,
  edgeWeight: number = config.FACE_FIT_EDGE_WEIGHT,
): number {
  const cw = region.side / 3;
  let total = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      const { rgb, spread } = cellStats(patch, x0, y0, w, h, centerFrac, samples);
      const lab = rgb2lab(rgb);
      let best = Infinity;
      for (const name of COLOR_NAMES) best = Math.min(best, deltaE(lab, refs[name]));
      // Недобор окантовки. Насыщается на gapTarget: у белой наклейки щели темнее
      // её на сотню единиц, у синей — на десятки, и штрафовать синюю нельзя.
      const deficit = Math.max(
        0,
        gapTarget - cellGapContrast(patch, x0, y0, w, h, luma(rgb), bandFrac, samples),
      );
      // Недобор контраста границ — тот же приём, что и у щели, но по цвету.
      const deficitEdge = Math.max(
        0,
        edgeTarget -
          cellEdgeContrast(
            patch,
            x0,
            y0,
            w,
            h,
            row > 0,
            row < 2,
            col > 0,
            col < 2,
            bandFrac,
            samples,
          ),
      );
      // ΔE до ближайшего эталона — основная часть; разброс внутри ячейки —
      // добавка, которая штрафует сетку, севшую на щели. Два структурных
      // слагаемых НЕЗАВИСИМЫ (см. комментарий у edgeTarget выше): щель — сигнал
      // стикерного кубика, граница — stickerless, и ослаблять один ради
      // другого нельзя.
      total += best + spread * 0.35 + deficit * gapWeight + deficitEdge * edgeWeight;
    }
  }
  return total / 9;
}

/**
 * Кандидаты: масштаб грани внутри патча × сдвиг по обеим осям.
 *
 * Диапазон масштабов начинается с 0.4, а не с 0.62. Прежняя нижняя граница
 * молча требовала, чтобы грань занимала минимум две трети рамки; человек,
 * держащий кубик чуть дальше, получал грань в половину рамки — правильного
 * положения в переборе НЕ БЫЛО ВОВСЕ, и подгонка выбирала лучший из заведомо
 * неверных. Живой прогон это и показал: «подогнана» на всех шести гранях при
 * контрасте щелей около нуля, то есть решётку не нашли нигде, а промахи имели
 * цвета-смеси (серо-бежевый, оливковый) — усреднение двух наклеек через щель.
 *
 * Шаг сдвига задаётся в долях ЯЧЕЙКИ, а не области: ошибка в полячейки и есть
 * та самая ошибка, из-за которой ячейка читает соседа.
 */
export function candidateRegions(patchSize: number, stepFrac = 0.34): FitRegion[] {
  const out: FitRegion[] = [];
  for (const scale of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
    const side = patchSize * scale;
    const slack = patchSize - side;
    if (slack < 2) {
      out.push({ x: 0, y: 0, side });
      continue;
    }
    // Шаг — доля ячейки (side/3), но не мельче пикселя.
    const step = Math.max(1, (side / 3) * stepFrac);
    const n = Math.ceil(slack / step);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        out.push({ x: Math.min(slack, i * step), y: Math.min(slack, j * step), side });
      }
    }
  }
  return out;
}

/**
 * Уточнение вокруг найденного кандидата: тот же перебор, но мелкой сеткой в
 * окрестности победителя.
 *
 * Нужен, чтобы расширение диапазона не стоило времени. Грубый проход отвечает на
 * вопрос «где примерно грань», уточнение — «где именно», и второй вопрос имеет
 * смысл задавать только в одном месте, а не по всему патчу.
 */
export function refineRegions(patchSize: number, around: FitRegion): FitRegion[] {
  const out: FitRegion[] = [];
  const cell = around.side / 3;
  const posStep = Math.max(1, cell * 0.08);
  const sideStep = Math.max(1, around.side * 0.04);
  for (let ds = -1; ds <= 1; ds++) {
    const side = around.side + ds * sideStep;
    if (side < 12 || side > patchSize) continue;
    const maxOff = patchSize - side;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const x = around.x + dx * posStep;
        const y = around.y + dy * posStep;
        if (x < 0 || y < 0 || x > maxOff || y > maxOff) continue;
        out.push({ x, y, side });
      }
    }
  }
  return out;
}

const CANDIDATE_SCALES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/** Индекс масштаба кандидата в {@link CANDIDATE_SCALES} (по ближайшему side). */
function scaleIndexOf(side: number, patchSize: number): number {
  let idx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < CANDIDATE_SCALES.length; i++) {
    const diff = Math.abs(side - patchSize * CANDIDATE_SCALES[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      idx = i;
    }
  }
  return idx;
}

/** Argmin-метка каждой из 9 ячеек кандидата — то же чтение, что даёт продукт. */
function regionLabels(
  patch: Patch,
  region: FitRegion,
  refs: Refs,
  centerFrac: number,
  samples: number,
): string[] {
  const cw = region.side / 3;
  const labels: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.round(region.x + col * cw);
      const y0 = Math.round(region.y + row * cw);
      const w = Math.round(region.x + (col + 1) * cw) - x0;
      const h = Math.round(region.y + (row + 1) * cw) - y0;
      const { rgb } = cellStats(patch, x0, y0, w, h, centerFrac, samples);
      const lab = rgb2lab(rgb);
      let best = COLOR_NAMES[0];
      let bestD = Infinity;
      for (const name of COLOR_NAMES) {
        const d = deltaE(lab, refs[name]);
        if (d < bestD) {
          bestD = d;
          best = name;
        }
      }
      labels.push(best);
    }
  }
  return labels;
}

function labelsDiffer(a: readonly string[], b: readonly string[]): boolean {
  return a.some((v, i) => v !== b[i]);
}

// Сколько кандидатов грубого прохода пере-оцениваем точной мерой ради `margin`.
// Без этой границы честно сравнивать пришлось бы КАЖДОГО из ~70 кандидатов, то
// есть точных оценок стало бы ~600 вместо нынешних ~76 (план, шаг 5, A10:
// бюджет времени патча — не дороже вдвое). 8 — с запасом больше числа
// кандидатов, реально живущих в окрестности ±1 шаг масштаба / 1 ячейка сдвига.
const MARGIN_TOP_K = 8;

/**
 * Найти квадрат грани внутри патча.
 *
 * `baseline` — область, которую взяли бы без подгонки (весь патч, если рамка и
 * есть предполагаемая грань). Возвращается вместе с оценкой, чтобы вызывающий
 * мог решить, доверять ли подгонке: если выигрыш крошечный, дешевле остаться на
 * прежней геометрии, чем дёргать сетку от кадра к кадру.
 *
 * `margin`/`decided` — ТЕЛЕМЕТРИЯ (не влияет на выбор `region`). Сравнивать
 * стоимость победителя есть смысл только с соперниками из его ОКРЕСТНОСТИ:
 * кандидат другого масштаба меряет другую площадь (у крупного кандидата ячейка
 * шире, `best` растёт по причине, не связанной с тем, там ли грань), поэтому
 * сравнение ограничено ±1 шагом масштаба и ≤1 ячейкой сдвига. И только с теми,
 * чьи 9 меток-аргминов ОТЛИЧАЮТСЯ от меток победителя — совпадающий по ответу
 * кандидат не соперник, а тот же самый вывод другими координатами.
 */
export function fitFaceRegion(patch: Patch, refs: Refs, centerFrac = 0.5): FitResult {
  const { GAP_TARGET, GAP_WEIGHT, BAND, EDGE_TARGET, EDGE_WEIGHT, MIN_MARGIN } = fitParams();
  // Перебор идёт по ПРОРЕЖЕННЫМ отсчётам: медиана ячейки от этого не меняется, а
  // семь сотен кандидатов на полном разрешении стоили секунды на каждую грань.
  const coarse = (r: FitRegion): number =>
    regionCost(
      patch,
      r,
      refs,
      centerFrac,
      GAP_TARGET,
      GAP_WEIGHT,
      BAND,
      10,
      EDGE_TARGET,
      EDGE_WEIGHT,
    );
  const fine = (r: FitRegion): number =>
    regionCost(
      patch,
      r,
      refs,
      centerFrac,
      GAP_TARGET,
      GAP_WEIGHT,
      BAND,
      20,
      EDGE_TARGET,
      EDGE_WEIGHT,
    );

  const baseline: FitRegion = { x: 0, y: 0, side: patch.size };
  let best = baseline;
  let bestCoarse = coarse(baseline);
  const coarseRanked: { region: FitRegion; cost: number }[] = [
    { region: baseline, cost: bestCoarse },
  ];
  // Грубый проход: где примерно сидит грань.
  for (const cand of candidateRegions(patch.size)) {
    const cost = coarse(cand);
    coarseRanked.push({ region: cand, cost });
    if (cost < bestCoarse) {
      bestCoarse = cost;
      best = cand;
    }
  }
  const coarseWinner = best;
  // Уточнение: где именно. Без него шаг грубой сетки (четверть ячейки) остаётся
  // в остатке, а четверть ячейки — это уже полоса чужой наклейки в выборке.
  // Уточнение гоняется ТОЛЬКО вокруг грубого победителя — топ-K ниже пере-
  // оценивается точной мерой БЕЗ дальнейшего уточнения (план, шаг 5).
  let bestCost = fine(best);
  for (const cand of refineRegions(patch.size, best)) {
    const cost = fine(cand);
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }

  coarseRanked.sort((a, b) => a.cost - b.cost);
  const winnerLabels = regionLabels(patch, best, refs, centerFrac, 20);
  const winnerScaleIdx = scaleIndexOf(coarseWinner.side, patch.size);
  const winnerCell = coarseWinner.side / 3;
  let margin = Infinity;
  for (const cand of coarseRanked.slice(0, MARGIN_TOP_K)) {
    if (cand.region === coarseWinner) continue;
    if (Math.abs(scaleIndexOf(cand.region.side, patch.size) - winnerScaleIdx) > 1) continue;
    if (
      Math.abs(cand.region.x - coarseWinner.x) > winnerCell ||
      Math.abs(cand.region.y - coarseWinner.y) > winnerCell
    ) {
      continue;
    }
    const labels = regionLabels(patch, cand.region, refs, centerFrac, 20);
    if (!labelsDiffer(labels, winnerLabels)) continue;
    margin = Math.min(margin, fine(cand.region) - bestCost);
  }
  const decided = margin >= MIN_MARGIN;

  // Итоговые числа — на общей мерке с базовой рамкой, иначе «выигрыш» сравнивал
  // бы стоимости, посчитанные с разной плотностью выборки.
  return { region: best, cost: fine(best), baselineCost: fine(baseline), margin, decided };
}

function fitParams(): {
  GAP_TARGET: number;
  GAP_WEIGHT: number;
  BAND: number;
  EDGE_TARGET: number;
  EDGE_WEIGHT: number;
  MIN_MARGIN: number;
} {
  return {
    GAP_TARGET: config.FACE_FIT_GAP_TARGET,
    GAP_WEIGHT: config.FACE_FIT_GAP_WEIGHT,
    BAND: config.FACE_FIT_GAP_BAND_FRAC,
    EDGE_TARGET: config.FACE_FIT_EDGE_TARGET,
    EDGE_WEIGHT: config.FACE_FIT_EDGE_WEIGHT,
    MIN_MARGIN: config.FACE_FIT_MIN_MARGIN,
  };
}

/** Решётка съёмки против решётки её соседей по тому же чтению. */
export interface LatticeVerdict {
  /** Признаки решётки обвалились у ОБОИХ замеров — съёмка сделана не по грани. */
  collapsed: boolean;
  /** Контраст границ этой съёмки к медиане соседей (1 = как у всех). */
  edgeRatio: number;
  /** То же для контраста щелей. */
  gapRatio: number;
  /** Медианы соседей — их печатает отказ, чтобы человек видел, с чем сравнили. */
  edgeMedian: number;
  gapMedian: number;
}

/**
 * Съёмка сделана мимо грани? Сравниваем её решётку с решёткой соседних съёмок
 * ТОГО ЖЕ чтения.
 *
 * Зачем нужен отдельный замок. `regionCost` штрафует недобор контраста щелей и
 * границ, но это СЛАГАЕМЫЕ стоимости, а не отказ: кандидат с нулевой решёткой
 * всё равно побеждает рамку, если фон ближе к эталонам, чем края кубика, — и
 * подгонка отчитывается «ПОДОГНАНА, выигрыш 30.7» о сетке, половина которой
 * стоит на столе. Живой прогон 2026-08-19 (stickerless, LED) на этом и
 * развалился: пять ячеек грани U прочитались белыми с ΔE 2–4, потому что там
 * был белый стол, а не белая наклейка. Замок `FACE_MAX_MEDIAN_DE` такое не
 * ловит по устройству — белый стол похож на цвет кубика, он и есть цвет кубика.
 *
 * Почему сравнение с соседями, а не с числом. Абсолютного порога тут не
 * существует: в том же прогоне здоровая грань F дала контраст щелей 3.3, а
 * сломанная U — 4.0. Разделяет их только контекст: у F границы 39.5 при медиане
 * соседей 41, у U — 5.3. Соседи сняты тем же кубиком в том же свете минуту
 * назад, это самая честная мерка, какая есть.
 *
 * Почему нужны ОБА признака. Грань, где рядом лежат наклейки одного цвета, даёт
 * низкий контраст границ законно — по одному этому признаку её забраковали бы
 * ни за что. Щели у такой грани на месте. И наоборот: у stickerless щелей почти
 * нет, но цвета через границу меняются. Обвал ОБОИХ разом — это уже не грань.
 */
export function latticeVerdict(
  face: { gap: number; edge?: number },
  others: readonly { gap: number; edge?: number }[],
  frac: number = config.FACE_FIT_COLLAPSE_FRAC,
): LatticeVerdict {
  const edges = others.map((o) => o.edge).filter((e): e is number => typeof e === "number");
  const gaps = others.map((o) => o.gap);
  const edgeMedian = edges.length ? median(edges) : 0;
  const gapMedian = gaps.length ? median(gaps) : 0;
  const edgeRatio = edgeMedian > 0 && typeof face.edge === "number" ? face.edge / edgeMedian : 1;
  const gapRatio = gapMedian > 0 ? face.gap / gapMedian : 1;
  // Меньше двух соседей — медиана ещё не медиана, а случайное число; молчим.
  // Так же молчим, если у соседей самих нет решётки: тогда сравнивать не с чем,
  // и вопрос не к этой съёмке, а ко всему чтению.
  const comparable = others.length >= 2 && edgeMedian > 0 && gapMedian > 0;
  return {
    collapsed: comparable && edgeRatio < frac && gapRatio < frac,
    edgeRatio,
    gapRatio,
    edgeMedian,
    gapMedian,
  };
}
