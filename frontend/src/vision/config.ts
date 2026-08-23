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
  // Минимальный вес такой ячейки в раздаче квот (см. colors.cellWeight): её
  // мнение о цвете стоит дешевле, но не ноль — иначе она уедет в случайный слот.
  CELL_WEIGHT_MIN: number;
  // Порог уверенности классификации наклейки (см. hooks/useCubeReader).
  STICKER_MARGIN_MIN: number; // минимальный отрыв ΔE второго кандидата от первого
  STICKER_MAX_DELTA_E: number; // дальше этого от эталона — чтение не считается уверенным
  // Множитель светлоты в метрике ВЫБОРА цвета (см. colors.deltaEClassify).
  // 1 — обычный CIEDE2000; 2 — светлота весит вдвое меньше.
  CLASSIFY_KL: number;
  FACE_MIN_CONFIDENT_CELLS: number; // сколько из 9 ячеек должны быть ЧИТАЕМЫ (не блик и не мимо)
  // Сколько ячеек грани могут иметь СПОРНЫЙ цвет (два близких кандидата), пока
  // грань всё ещё принимается. Отдельно от предыдущего порога: спор — не дырка
  // в данных, его разрешают квоты 9×6 и физика поворотов на полном чтении.
  FACE_MAX_AMBIGUOUS_CELLS: number;
  // Раскладка шести съёмок по шести цветам (cubeGrid.assignFacesByCenter) идёт
  // целиком, минимальной суммой, и потому не отказывает никогда. Этот порог и
  // есть её отказ: центр дальше него от назначенного эталона — значит грань
  // показали дважды или свет ушёл, и честнее переснять, чем угадать.
  CENTER_MAX_DELTA_E: number;
  // Насколько центру одной съёмки позволено отстать от МЕДИАНЫ остальных пяти.
  // Свет, уехавший у всей сессии, двигает все шесть одинаково — это лечится
  // нормировкой и чтения не портит; стол или рука в рамке выбивает ровно одну
  // съёмку, и вот её надо переснять. Абсолютный порог эти два случая не
  // различает вовсе.
  CENTER_OUTLIER_DE: number;
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
  // Структурный признак ДЛЯ STICKERLESS (см. vision/faceFit.cellEdgeContrast):
  // у монолитного кубика между наклейками нет тёмного корпуса, поэтому
  // FACE_FIT_GAP_TARGET там не срабатывает никогда — признак берёт РАЗНИЦУ
  // ЦВЕТА через внутреннюю границу сетки вместо разницы яркости на щели.
  // Независимое слагаемое стоимости (не max с gap-признаком, см. faceFit.ts).
  FACE_FIT_EDGE_TARGET: number; // насколько ΔE через границу должен отличаться, чтобы не штрафовать
  FACE_FIT_EDGE_WEIGHT: number; // вес недобора контраста границ в стоимости кандидата
  // Отрыв (в единицах regionCost) от ближайшего НЕСОГЛАСНОГО соперника в
  // окрестности победителя, ниже которого подгонка честно не знает ответа
  // (см. FitResult.margin/decided). ТЕЛЕМЕТРИЯ — гейт 0.3 её не читает вообще
  // (docs/qa/stage-0.3-vision-accuracy.md, «дропы в знаменателе»: путь гейта
  // расширять машинерией отказа рано, сначала нужны живые числа).
  FACE_FIT_MIN_MARGIN: number;
  // Доля от медианы соседних граней ТОГО ЖЕ чтения, ниже которой решётка
  // считается обвалившейся: съёмка сделана не по грани.
  FACE_FIT_COLLAPSE_FRAC: number;
  // Средний телесный тон (не эталон кубика) — для счётчика в отчёте «ячеек,
  // чей цвет ближе к телесному, чем к любому эталону» (accuracy.formatReport).
  // Живой прогон 2026-08-05: фон при свободной хватке RGB(162,124,99)..
  // (194,129,104); отсюда среднее. НЕ порог гейта (out of scope, см. план) —
  // только число для отчёта, недоказанную посылку «кожа = съехавшая сетка»
  // подтверждают или опровергают данными, а не декларацией.
  FACE_FIT_SKIN_RGB: [number, number, number];
  // Гамма кожи в YCbCr (Chai & Ngan) — по ней ячейка с пальцем отличается от
  // оранжевой наклейки, к которой она близка в Lab. См. colors.skinFraction.
  SKIN_CB_MIN: number;
  SKIN_CB_MAX: number;
  SKIN_CR_MIN: number;
  SKIN_CR_MAX: number;
  // Доля пикселей ячейки в гамме кожи, выше которой ячейка считается закрытой
  // пальцем, а съёмка — непригодной.
  CELL_SKIN_FRAC_MAX: number;
  // Насколько сырому чтению позволено разойтись с «по девять каждого цвета»,
  // чтобы квоты 9×6 вообще применялись (см. hooks/useCubeReader).
  QUOTA_MAX_SKEW: number;
  // Плёнка блика: насколько ячейка светлее САМОГО СВЕТЛОГО эталона (L в Lab) и
  // насколько при этом упала её хрома. Только для отчёта — ни отказа, ни порога
  // в пути гейта (см. accuracy.glareFilmSuspect).
  GLARE_LIFT_L: number;
  GLARE_MAX_CHROMA: number;
  // Замки на негодную калибровку (см. colors.checkCalibration). Белая наклейка —
  // самая светлая из шести при любом свете; если снятый «белый» темнее, в кадре
  // была не грань (рука, стол). Slack — запас на шум: на живом прогоне белый
  // опережал жёлтую всего на единицу.
  CALIB_WHITE_LIGHTNESS_SLACK: number;
  // Ниже этой светлоты (L в Lab) снятый белый — уже не белый, а серый: сцена
  // недосвечена или кубик далеко от камеры. Калибровку это НЕ блокирует (замок
  // «белый самый светлый» отдельно и строже), но предупреждает: на сером белом
  // любая ровная светлая поверхность — стол, стена — читается как грань U, и
  // именно так на живом прогоне два центра оказались одним цветом.
  CALIB_MIN_WHITE_L: number;
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
  // Сколько ждать после старта потока, прежде чем просить ручные экспозицию и
  // баланс белого: замок, поставленный в переходном процессе, консервирует
  // случайное промежуточное состояние.
  CAMERA_SETTLE_MS: number;
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
  CELL_WEIGHT_MIN: 0.2,
  STICKER_MARGIN_MIN: 4,
  STICKER_MAX_DELTA_E: 34,
  // Живой прогон 2026-08-20: нижний ряд синей грани снялся светлее остальных
  // (RGB 89,159,249 против эталона 9,101,207) и по обычной метрике оказался
  // ближе к белому — 16.6 против 20.4. При kL=2 те же ячейки дают 11.0 до
  // синего против 13.7 до белого. Цена: минимальное расстояние между
  // эталонами падает с 16.3 до 14.4 при пороге вердикта 10.
  CLASSIFY_KL: 2,
  // Между здоровой гранью (медиана ~4 на живом прогоне) и фоном (20.6) огромная
  // щель; 16 стоит в ней с запасом в обе стороны. Выше 20 замок пропустил бы
  // ровно тот отказ, ради которого написан, ниже 12 — рисковал бы честной гранью
  // на подсаженном профиле, где свет ушёл, а нормировка ещё не применена.
  FACE_MAX_MEDIAN_DE: 16,
  FACE_MIN_CONFIDENT_CELLS: 8,
  // Живая жалоба 2026-08-24: три отказа подряд при 3, 2 и 4 спорных ячейках,
  // и ни одной выбитой или далёкой — спорил красный с оранжевым. 3 пропускает
  // первые два случая к квотам, которые для этого и написаны, и оставляет
  // отказ там, где спорит почти половина грани.
  FACE_MAX_AMBIGUOUS_CELLS: 3,
  // Замерено на синтетике: равномерный сдвиг света, даже вдвое по каналу,
  // уводит центры максимум на ~28 — до 34 он не достаёт. Значит центр за этим
  // порогом означает не «свет уехал», а «это не цвет кубика», и порог остаётся
  // там, где стоял. Реально срабатывает почти всегда относительный замок ниже:
  // он ловит выбившуюся съёмку раньше, чем она доберётся до потолка.
  CENTER_MAX_DELTA_E: 34,
  CENTER_OUTLIER_DE: 18,
  FACE_FIT_MIN_GAIN: 1.5,
  FACE_FIT_GAP_TARGET: 12,
  FACE_FIT_GAP_WEIGHT: 1.0,
  FACE_FIT_GAP_BAND_FRAC: 0.12,
  FACE_FIT_EDGE_TARGET: 12,
  // Стартует с нуля НАМЕРЕННО: «стикерный кубик не изменился» — доказанное
  // тождество (см. faceFit.test.ts, «EDGE_WEIGHT=0 не меняет...»), а не
  // гипотеза. Поднимается только после того, как тождество зафиксировано
  // тестом (план, шаг 2). 0.5 — калибровано на синтетике (faceFit.test.ts):
  // margin(shift1cell) на stickerless растёт с 3.66 (вес 0) до 4.32 (вес 0.5),
  // а marginWith на СТИКЕРНОЙ фикстуре («сползшая сетка», faceFit.test.ts)
  // остаётся 4.12 — с запасом выше требуемых `FACE_FIT_MIN_GAIN*2`=3.00. Вес 1
  // уже роняет marginWith до 3.27 на грани требуемого — 0.5 оставляет запас.
  FACE_FIT_EDGE_WEIGHT: 0.5,
  FACE_FIT_MIN_MARGIN: 2,
  // Порог ОТНОСИТЕЛЬНЫЙ, и это не вкусовщина. Живой прогон 2026-08-19
  // (stickerless, LED) дал в одном чтении контраст щелей 3.3 на здоровой грани F
  // и 4.0 на сломанной U — абсолютным числом их не разделить никогда. Зато та же
  // U против своих соседей: границы 5.3 при медиане 41 (0.13), щели 4.0 при
  // медиане 12.1 (0.33), тогда как здоровая F держит по границам 0.90. Между
  // 0.33 и 0.90 порог 0.35 стоит с запасом в обе стороны.
  FACE_FIT_COLLAPSE_FRAC: 0.35,
  FACE_FIT_SKIN_RGB: [178, 127, 102],
  SKIN_CB_MIN: 77,
  SKIN_CB_MAX: 127,
  SKIN_CR_MIN: 133,
  SKIN_CR_MAX: 173,
  // Половина ячейки. Не «хоть один пиксель»: край наклейки ловит блик, кромку
  // пальца в соседней ячейке и шум сенсора, и на пороге в проценты харнесс
  // отказывал бы всегда. Половина — это уже палец ПОВЕРХ наклейки, а не рядом
  // с ней; в живом прогоне 2026-08-19 испорченные ячейки были закрыты целиком.
  CELL_SKIN_FRAC_MAX: 0.5,
  // Живой прогон 2026-08-21 (день, stickerless): промахи грани U сидели на
  // ячейках RGB(224,219,210) и (231,225,216) при kept 75% и 100% — счётчик
  // пересвета их не видит, он считает только долю КЛИПНУТЫХ пикселей. Их
  // светлота 87–90 против белого эталона 83, то есть ячейка СВЕТЛЕЕ снятого
  // белого, чего у настоящей наклейки не бывает: белее белого в этом свете
  // ничего нет. Порог 3 отделяет их от здоровых белых (те легли в ±1.5), а
  // хрома 12 — от цветных наклеек (у тех 30+) при хроме белого эталона ~6.
  GLARE_LIFT_L: 3,
  GLARE_MAX_CHROMA: 12,
  CALIB_WHITE_LIGHTNESS_SLACK: 3,
  // Живой прогон 2026-08-03: белый снялся как L=67 (RGB 162,165,159) — это серый,
  // и чтение развалилось. У здорового белого при рабочем свете L под 85–95.
  CALIB_MIN_WHITE_L: 75,
  CALIB_MIN_SEPARATION_DE: 10,
  CAPTURE_FRAMES: 5,
  CAPTURE_FRAME_GAP_MS: 22,
  FACE_CONFIDENCE_RETRIES: 2,

  QUOTA: 9,
  // Квоты чинят ОДНУ заблудившуюся наклейку: одного цвета стало десять, другого
  // восемь. Когда перекос больше, посылка «одна ячейка ошиблась» неверна — это
  // сломалась целая грань, и раздача затыкает её дыру, ДВИГАЯ верно прочитанные
  // ячейки на других гранях. Живые прогоны 2026-08-23: при перекосе 2
  // продуктовое чтение вышло 47/54 и 43/54 против сырых 50/54 и 49/54; при
  // перекосе 1 — 49/54 против 50/54. Отсюда порог: 1 квоты пускает, 2 нет.
  QUOTA_MAX_SKEW: 1,
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
  CAMERA_SETTLE_MS: 1200,
};
