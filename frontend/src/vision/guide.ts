// Pure guidance layer for the Stage-0 rig. NO DOM, NO CV, NO state of its own.
// guideStateFor() is a projection: it maps a SNAPSHOT of the existing main.ts
// variables to what the human should read on screen right now. There is no
// click-incremented counter here — progress is bound to the real collector face
// count, so a failed capture never advances the guide (skeptic HIGH#2, LOW).
//
// All copy is Russian, plain spoken, no CV jargon. UTF-8 without BOM.

import { type CalibrationProblem } from "./colors";

export type GuideStep =
  | "start" // camera not running yet
  | "calibrate" // capturing the 6 solved faces
  | "lightBad" // calibration done but red/orange too close
  | "ready" // calibrated, no scramble prepared
  | "scrambleReady" // hand-scramble mode: cube mixed, show 6 to gate; or B mode
  | "verifyScramble" // notation scramble applied, must verify before timing
  | "collecting" // a 6-face collection is in progress
  | "armTimer" // scramble verified, put hands in zones
  | "solving" // timer running
  | "stopped" // solve finished, confirm/next
  | "error"; // human-readable error takes over the panel

export interface GuideState {
  step: GuideStep;
  titleRu: string;
  nowRu: string; // one sentence: what to do RIGHT NOW
  nextRu: string; // what comes after
  activeButtonId: string | null; // the single recommended button (.guide-next)
  progress?: string; // e.g. "Грань 2/6"
}

// Gate mode for the accuracy step (Mode A hand-mix vs Mode B solved cube).
export type GateMode = "handmix" | "solved";

// A snapshot of the EXISTING main.ts variables. guideStateFor reads only this.
export interface GuideSnapshot {
  cameraOn: boolean;
  calibrationStep: number; // 0..6
  hasRefs: boolean;
  redOrangeOk: boolean; // false => bad light after calibration
  scrambleSet: boolean; // a notation scramble was generated (product path)
  scrambleVerified: boolean;
  gateMode: GateMode;
  // The REAL collector, or null. faces = ensureReadable-passed captures.
  collector: { purpose: "verify" | "confirm" | "accuracy"; facesLength: number } | null;
  fsmState: string; // NO_HANDS / HANDS_IN_ZONE / READY / SOLVING / STOPPED / ...
  solveElapsedMs: number;
  lastError: string | null; // human-readable Russian error, or null
}

export const FACE_LABELS_RU: Record<string, string> = {
  U: "белая (верх)",
  R: "красная (право)",
  F: "зелёная (перед)",
  D: "жёлтая (низ)",
  L: "оранжевая (лево)",
  B: "синяя (зад)",
};

export const COLOR_LABELS_RU: Record<string, string> = {
  U: "белый",
  R: "красный",
  F: "зелёный",
  D: "жёлтый",
  L: "оранжевый",
  B: "синий",
};

// Calibration face order matches COLOR_NAMES in colors.ts: U R F D L B.
const CALIB_ORDER = ["U", "R", "F", "D", "L", "B"];

export function remainingCalibFacesRu(calibrationStep: number, t: T = ruT): string {
  return CALIB_ORDER.slice(calibrationStep)
    .map((f) => t(FACE_LABELS_RU[f]))
    .join(", ");
}

import { translate } from "../i18n/t";

// ---- Error copy --------------------------------------------------------------
//
// Функции возвращают ГОТОВУЮ фразу. Статические — это сами ключи перевода
// (см. i18n/t.ts): их переводят в месте показа. Динамическим нужен переводчик
// параметром: фразу с числами нельзя склеить из русских кусков и потом перевести.

/** Переводчик по умолчанию — русский, то есть «вернуть ключ как есть». */
type T = (key: string, params?: Record<string, string | number>) => string;
const ruT: T = (key, params) => translate("ru", key, params);

export function cameraDeniedRu(): string {
  return "Нет доступа к камере. Разреши камеру в браузере и нажми «Включить камеру» ещё раз.";
}
export function modelFailedRu(): string {
  return "Не удалось скачать модель рук. Проверь интернет и обнови страницу.";
}
export function lightBadRu(de: number, minDe: number, t: T = ruT): string {
  return t(
    "Свет плохой: красный и оранжевый почти одинаковы (ΔE {de} < {min}). Поменяй свет и откалибруй заново.",
    { de: de.toFixed(1), min: minDe },
  );
}
export function lumaBadRu(luma: number, min: number, max: number, t: T = ruT): string {
  const dir = t(luma < min ? "слишком темно" : "слишком светло");
  return t("{dir} (яркость {luma}, нужно {min}–{max}). Поменяй свет и попробуй снова.", {
    dir,
    luma: luma.toFixed(0),
    min,
    max,
  });
}
export function verifyMismatchRu(face: string, count: number, t: T = ruT): string {
  const label = t(FACE_LABELS_RU[face] ?? face);
  return t(
    "Грани не совпали: расходится {count} наклеек, первая — на грани {face}. Собери разброс как надо или сделай новый и проверь заново.",
    { count, face: label },
  );
}
export function rotationAmbiguousRu(): string {
  return "Не смог однозначно собрать кубик из граней. Покажи 6 граней заново, не спеша.";
}
export function rotationFailedRu(): string {
  return "Грани не складываются в целый кубик. Покажи каждую грань чётко в рамке и повтори.";
}
export function faceUnreadableRu(): string {
  return "Грань не прочиталась — повтори. Держи её ровно в жёлтой рамке.";
}
/**
 * В рамке не грань кубика, а фон. Формулировка называет причину прямо: человек
 * сам видит стол в кадре, ему нужно услышать «наведи на кубик», а не «грань не
 * прочиталась» — за той же фразой стоят блик, тень и спорный цвет, лечатся они
 * иначе. Цифра оставлена в тексте: по ней настраивается порог, если он окажется
 * злым на конкретной камере.
 */
export function notACubeFaceRu(medianDE: number, t: T = ruT): string {
  return t(
    "В рамке не грань кубика: все ячейки далеки от цветов кубика (медиана ΔE {de}). Похоже, в кадр попал стол, стена или рука — наведи рамку на кубик и сними грань заново.",
    { de: medianDE.toFixed(1) },
  );
}
/**
 * Палец лежит на снимаемой грани.
 *
 * Своя формулировка, потому что своё лечение. «Не грань кубика» просит навести
 * рамку, «нет решётки» — показать грань целиком, а здесь и рамка, и грань на
 * месте: закрыты конкретные наклейки. Живой прогон 2026-08-19 дал по три-четыре
 * такие ячейки на чтение, и все они уходили в счёт как уверенно прочитанный
 * оранжевый — телесный тон к нему ближе всего.
 */
export function fingerOnFaceRu(cells: number, worstPct: number): string {
  return (
    `Палец на грани: ${cells === 1 ? "одна ячейка закрыта" : `закрытых ячеек ${cells}`} ` +
    `(худшая — на ${worstPct.toFixed(0)}%). Кожа по цвету ближе всего к оранжевой наклейке, ` +
    "поэтому такая ячейка читается уверенно и неверно. Держи кубик за боковые рёбра, " +
    "чтобы пальцы не лежали на показываемой грани, и сними её заново."
  );
}

/**
 * При строгой хватке показали не ту грань, которую ждёт порядок.
 *
 * Проверка на это была и раньше, но СОВЕЩАТЕЛЬНАЯ: центр далеко от ожидаемого
 * эталона — пишем «грань уплыла, сняли всё равно». Для дрейфа света это верно
 * (автобаланс белого гуляет, и отказывать из-за него значит не собрать данных
 * вовсе), а для показанной не той грани — нет: живой прогон 2026-08-19 засчитал
 * жёлтую грань вместо оранжевой и записал зрению девять ошибок, которых оно не
 * делало, уронив чтение с 45/45 до 45/54.
 *
 * Разводит эти два случая не величина, а НАПРАВЛЕНИЕ: уехавший свет двигает
 * центр в никуда — далеко от всех шести эталонов сразу. Чужая грань садится
 * ТОЧНО на другой эталон. Второе и есть условие отказа.
 */
export function wrongFaceRu(
  expected: string,
  got: string,
  position: number,
  expectedDE: number,
  gotDE: number,
): string {
  const want = CENTRE_COLOUR_RU[expected] ?? expected;
  const have = CENTRE_COLOUR_RU[got] ?? got;
  return (
    `Это грань с ${have} центром (ΔE ${gotDE.toFixed(1)}), а ${position}-й по протоколу ` +
    `снимается грань с ${want} центром — до него ${expectedDE.toFixed(1)}. ` +
    "Порядок строгой хватки: U R F D L B, то есть белый, красный, зелёный, жёлтый, оранжевый, синий. " +
    "Покажи нужную грань — или переключись на свободную хватку, если держать порядок не хочешь."
  );
}

/**
 * Съёмка сделана мимо грани: решётки нет.
 *
 * Отдельная формулировка от «в рамке не грань кубика» (`notACubeFaceRu`), и это
 * не синонимы. Тот отказ срабатывает, когда цвета в рамке далеки от кубика — по
 * нему видно стол или руку. Здесь ровно наоборот: цвета БЛИЗКИ, потому что стол
 * белый, а белый есть и на кубике, и чтение выходит уверенным и неверным. Мимо
 * грани выдаёт не цвет, а отсутствие структуры — и текст обязан сказать именно
 * это, иначе человек пойдёт менять свет, которому нечего лечить.
 */
export function latticeCollapsedRu(
  face: string,
  edge: number,
  edgeMedian: number,
  gap: number,
  gapMedian: number,
): string {
  return (
    `Грань ${face} снята мимо: у неё нет решётки — контраст границ ${edge.toFixed(1)} ` +
    `при ${edgeMedian.toFixed(1)} у соседних граней, щелей ${gap.toFixed(1)} при ${gapMedian.toFixed(1)}. ` +
    "Похоже, край рамки ушёл за кубик — на стол или стену. Цвет фона может совпасть с цветом наклейки, " +
    "и тогда грань читается уверенно и неверно. Покажи эту грань заново: кубик целиком в рамке, ближе к камере."
  );
}

/**
 * То же, но обнаружено уже после шестой съёмки — переснять одну грань поздно,
 * чтение уходит в дроп целиком. Разделено с `latticeCollapsedRu` потому, что
 * человеку нужно разное действие: там «покажи эту грань заново», здесь «начни
 * чтение сначала».
 */
export function latticeCollapsedLateRu(faces: string[]): string {
  const list = faces.join(", ");
  return (
    `Чтение не засчитано: у ${faces.length > 1 ? "граней" : "грани"} ${list} нет решётки — ` +
    "сетка стояла не по кубику, а по фону рядом с ним, и цвета оттуда неотличимы от наклеек. " +
    "Сними чтение заново, держи кубик целиком в рамке."
  );
}

/**
 * Белый снят тускло. Не отказ, а предупреждение: калибровка формально годна
 * (белый всё ещё самый светлый из шести), но на сером «белом» серый стол и
 * светлая стена становятся законными кандидатами в грань U — и чтение
 * разваливается там, где цвета кубика ни при чём. Лечится светом и дистанцией,
 * а не порогами, поэтому текст говорит про свет, а не про число.
 */
export function dimWhiteWarningRu(whiteL: number, min: number, t: T = ruT): string {
  return t(
    "Белый снят тускло (светлота {l} при норме от {min}): сцена недосвечена или кубик далеко. Добавь света или поднеси кубик ближе и откалибруйся заново — иначе стол и стена будут читаться как белая грань.",
    { l: whiteL.toFixed(0), min: String(min) },
  );
}

/** Центр грани, названный цветом: человек не обязан знать нотацию U/R/F/D/L/B. */
const CENTRE_COLOUR_RU: Record<string, string> = {
  U: "белым",
  R: "красным",
  F: "зелёным",
  D: "жёлтым",
  L: "оранжевым",
  B: "синим",
};

/**
 * Раскладка шести съёмок по шести цветам не сошлась.
 *
 * Одиночный argmin в этом месте говорил «центр U встретился 2 раза» — фраза
 * описывает свой внутренний конфликт, а не то, что человеку делать. Раскладка
 * целиком таких конфликтов не создаёт, поэтому отказ у неё конкретный: вот эта
 * съёмка по счёту, вот цвет, который ей достался, вот насколько её центр далёк.
 *
 * Живой прогон 2026-08-05 показал, чего тексту не хватало.
 *
 *  1. Печатался порог АБСОЛЮТНОГО замка, когда срабатывал относительный, и
 *     сообщение опровергало само себя: «в 30.0 от цвета, допустимо 34». Теперь
 *     печатается тот порог, который реально сработал.
 *  2. Назывался ПЕРВЫЙ нарушитель, а не худший: человеку показали съёмку 5 с
 *     ΔE 30, пока настоящая беда сидела в шестой с ΔE 55.
 *  3. Главное: раскладка — бижекция, она обязана раздать все шесть цветов.
 *     Значит цвета, доставшиеся нарушителям, — ровно те центры, которых она
 *     не увидела. Это и есть готовый ответ «какие грани ты не показала»,
 *     и раньше он вычислялся, но выбрасывался.
 */
export function centerAssignFailedRu(
  offenders: {
    capture: number;
    face: string;
    de: number;
    relative: boolean;
    own?: string;
    ownDE?: number;
    duplicateOf?: number;
  }[],
  medianDE: number,
  maxAbs: number,
  maxRel: number,
  t: T = ruT,
): string {
  if (offenders.length === 0) return t("Грани не опознаны по центрам.");
  const worst = offenders.reduce((a, b) => (b.de > a.de ? b : a));
  const head = worst.relative
    ? t(
        "Съёмка {n} не опознана: её центр в {de} от цвета {face}, тогда как остальные съёмки держатся около {med} (отрыв больше {rel} — брак).",
        {
          n: String(worst.capture + 1),
          de: worst.de.toFixed(1),
          face: worst.face,
          med: medianDE.toFixed(1),
          rel: String(maxRel),
        },
      )
    : t("Съёмка {n} не опознана: её центр в {de} от цвета {face} (допустимо {max}).", {
        n: String(worst.capture + 1),
        de: worst.de.toFixed(1),
        face: worst.face,
        max: String(maxAbs),
      });

  // Дубликат и плохо прочитанный центр выглядят для раскладки одинаково, а
  // лечатся по-разному, поэтому и говорим о них РАЗНОЕ. Признак дубликата —
  // съёмка тянется к цвету, который уже занят другой, севшей на него лучше.
  const dupes = offenders.filter((o) => o.duplicateOf !== undefined);
  const misread = offenders.filter((o) => o.duplicateOf === undefined);

  const parts: string[] = [];
  if (dupes.length > 0) {
    const colours = dupes
      .map((o) => CENTRE_COLOUR_RU[o.face] ?? o.face)
      .filter((v, i, a) => a.indexOf(v) === i);
    parts.push(
      t("Похоже, ты не показала грань с {colours} центром — а показала что-то дважды.", {
        colours: colours.join(" и "),
      }),
    );
  }
  for (const o of misread) {
    parts.push(
      t(
        "Центр съёмки {n} не похож и на свой ближайший цвет ({own}, {ownDE}) — значит дело не в порядке граней: центр прочитан плохо. Кубик мог стоять наискось, центр — уехать из ячейки, или свет ушёл от калибровки.",
        {
          n: String(o.capture + 1),
          own: CENTRE_COLOUR_RU[o.own ?? ""] ?? o.own ?? "?",
          ownDE: (o.ownDE ?? 0).toFixed(1),
        },
      ),
    );
  }
  if (parts.length === 0) {
    parts.push(t("Либо одна и та же грань показана дважды, либо в рамку попал не кубик."));
  }
  const tail =
    dupes.length > 0
      ? t("Покажи шесть РАЗНЫХ граней, каждую — центром в рамку.")
      : t("Переснимай: держи грань ровно к камере и целиком в рамке.");

  return `${head} ${parts.join(" ")} ${tail}`;
}

/**
 * Расклад по всем шести съёмкам одной строкой: какой цвет кому достался и на
 * каком расстоянии сидит центр.
 *
 * Без него отказ сообщает одно число про одну съёмку, и по нему нельзя отличить
 * «в рамку попал стол» от «свет уехал у всей сессии»: в первом случае одна
 * съёмка торчит над остальными, во втором далеки все шесть. Диагностика, не
 * замер: в гейт эта строка не идёт.
 */
export function centerSpreadRu(
  faces: string[],
  des: number[],
  medianDE: number,
  /**
   * К какому цвету центр тянется САМ, вне бижекции, и его сырой RGB.
   *
   * Назначенного цвета мало. Живой прогон 2026-08-05 (stickerless, LED) дал
   * «1:L 37 … 5:U 1»: выглядит как «первая съёмка — плохая оранжевая», а на деле
   * камера увидела ДВА белых центра, и раскладка отдала белый лучшему, а первой
   * достался никем не занятый оранжевый. Понять это по назначенным цветам
   * нельзя в принципе — они и есть результат раздачи, а не то, что видела камера.
   */
  own?: string[],
  ownDes?: number[],
  rgb?: [number, number, number][],
): string {
  const parts = faces.map((f, i) => {
    const assigned = `${i + 1}:${f} ${(des[i] ?? 0).toFixed(0)}`;
    const ownPart =
      own?.[i] !== undefined ? ` (сам ${own[i]} ${(ownDes?.[i] ?? 0).toFixed(0)})` : "";
    const rgbPart = rgb?.[i] ? ` RGB(${rgb[i].map((v) => Math.round(v)).join(",")})` : "";
    return assigned + ownPart + rgbPart;
  });
  // Заголовок описывает РОВНО те поля, что напечатаны: обещать RGB, которого в
  // строке нет, — тот же сорт вранья, что «допустимо 34» при сработавшем
  // относительном замке.
  const header = own
    ? "Центры съёмок (номер:назначено ΔE (сам ΔE)" + (rgb ? " RGB" : "") + ")"
    : "Центры съёмок (номер:цвет ΔE)";
  return `${header}: ${parts.join(", ")}. Медиана ${medianDE.toFixed(1)}.`;
}

/**
 * Как легла сетка на каждой съёмке — второй вопрос к тому же отказу.
 *
 * Далёкий центр значит одно из двух, и лечатся они противоположно. В рамке
 * действительно не кубик — тогда подгонке не за что зацепиться, решётки нет,
 * контраст щелей низкий, сетка откатывается на рамку. Либо кубик в рамке был, а
 * сетка села мимо, и центральная ячейка попала на чёрную щель между наклейками —
 * тогда подгонка отчиталась об успехе, а цвет всё равно мусорный. Числа
 * разводят эти случаи, слова — нет.
 */
export function fitSpreadRu(fits: { used: boolean; gap: number; edge?: number }[]): string {
  // Печатаются ОБА признака решётки, потому что замок смотрит на оба, и по
  // одним щелям нельзя понять его решение. У монолитного кубика щели уходят в
  // ноль штатно (тени между деталями вместо чёрного корпуса), и строка «0, 1,
  // 2» без второго числа читается как приговор геометрии там, где всё в
  // порядке: границы при этом держат 40.
  const parts = fits.map((f, i) => {
    const edge = typeof f.edge === "number" ? `/${f.edge.toFixed(0)}` : "";
    return `${i + 1}:${f.used ? "подогнана" : "рамка"} ${f.gap.toFixed(0)}${edge}`;
  });
  return `Сетка по съёмкам (номер:как легла щели/границы): ${parts.join(", ")}.`;
}

/**
 * Почему шесть снятых граней не приняты. Человеку важно не «ошибка калибровки», а
 * что именно переснять: в кадр попала рука/стол вместо грани — или камера в этом
 * свете вообще не различает цвета кубика, и свет надо менять.
 */
export function calibrationRejectedRu(problem: CalibrationProblem): string {
  if (problem.kind === "white-not-lightest") {
    return "Калибровка не принята: снятый белый темнее других цветов — похоже, в рамку попала рука, стол или стена вместо грани. Сними все 6 граней заново, следи, чтобы в рамке была только грань кубика.";
  }
  return `Калибровка не принята: камера почти не различает ${problem.a} и ${problem.b} (ΔE ${problem.de.toFixed(1)}). Смени свет — уйди от цветных лампочек и прямого солнца — и сними 6 граней заново.`;
}

export function timerBlockedRu(): string {
  return "Таймер не пошёл: сначала проверь грани (кнопка проверки), потом ставь руки в зоны.";
}
export function dnfRu(): string {
  return "Сбор потерян: руки/кубик пропали из кадра. Начни цикл заново.";
}

// ---- Quick-adjust (one white face) copy -------------------------------------

export function quickAdjustWrongFaceRu(): string {
  return "Это не похоже на белую грань этого кубика — возможно, другой кубик или не та грань. Выбери профиль этого кубика или откалибруй заново по 6 граням.";
}
export function quickAdjustDivergedRu(): string {
  return "Не получилось уверенно снять белую грань (блики или наклейки читаются вразнобой). Откалибруй по 6 граням.";
}
export function solveVerifyMismatchRu(count: number, t: T = ruT): string {
  return t(
    "Кубик ещё не собран: расходится {count} наклеек. Дособерись и покажи 6 граней собранного кубика.",
    { count },
  );
}

// ---- The step machine -------------------------------------------------------

export function guideStateFor(s: GuideSnapshot): GuideState {
  if (s.lastError) {
    return {
      step: "error",
      titleRu: "Что-то пошло не так",
      nowRu: s.lastError,
      nextRu: "Исправь по подсказке выше и продолжай.",
      activeButtonId: null,
    };
  }

  if (!s.cameraOn) {
    return {
      step: "start",
      titleRu: "Шаг 1 — включи камеру",
      nowRu: "Нажми «Включить камеру» и разреши доступ.",
      nextRu: "Дальше откалибруем 6 граней собранного кубика.",
      activeButtonId: "btn-start",
    };
  }

  // A live 6-face collection takes over the panel while it runs.
  if (s.collector) {
    const n = s.collector.facesLength;
    const btn =
      s.collector.purpose === "verify"
        ? "btn-verify"
        : s.collector.purpose === "confirm"
          ? "btn-confirm"
          : "btn-accuracy";
    const what =
      s.collector.purpose === "verify"
        ? "проверяем разброс"
        : s.collector.purpose === "confirm"
          ? "проверяем сборку"
          : "измеряем точность зрения";
    return {
      step: "collecting",
      titleRu: `Показывай 6 граней — ${what}`,
      nowRu: `Держи грань в жёлтой рамке и жми ту же кнопку. Прочитано ${n}/6.`,
      nextRu: n < 6 ? "Покажи следующую грань." : "Читаю результат…",
      activeButtonId: btn,
      progress: `Грань ${Math.min(n + 1, 6)}/6`,
    };
  }

  // Calibration: 0..5 => still capturing; 6 => done (maybe bad light).
  if (s.calibrationStep < CALIB_ORDER.length) {
    const next = CALIB_ORDER[s.calibrationStep];
    return {
      step: "calibrate",
      titleRu: "Шаг 2 — калибровка цветов",
      nowRu: `Поднеси к рамке ${FACE_LABELS_RU[next]} грань собранного кубика и нажми «Снять грань».`,
      nextRu: `Осталось: ${remainingCalibFacesRu(s.calibrationStep)}.`,
      activeButtonId: "btn-calibrate",
      progress: `Грань ${s.calibrationStep + 1}/6`,
    };
  }

  if (!s.redOrangeOk) {
    return {
      step: "lightBad",
      titleRu: "Свет плохой",
      nowRu: "Красный и оранжевый почти одинаковы. Поменяй свет и откалибруй заново.",
      nextRu: "Нажми «Калибровать» и пройди 6 граней при другом свете.",
      activeButtonId: "btn-calibrate",
    };
  }

  // Notation-scramble path (product): if a scramble is set, verify before timing.
  if (s.scrambleSet && !s.scrambleVerified) {
    return {
      step: "verifyScramble",
      titleRu: "Проверь разброс перед таймером",
      nowRu:
        "Собери показанный разброс на кубике, потом нажми «Проверить грани» и покажи 6 граней.",
      nextRu: "После совпадения поставишь руки в зоны — пойдёт таймер.",
      activeButtonId: "btn-verify",
    };
  }

  if (s.scrambleVerified && s.fsmState !== "SOLVING" && s.fsmState !== "STOPPED") {
    return {
      step: "armTimer",
      titleRu: "Готово к таймеру",
      nowRu: "Поставь обе руки в зелёные зоны и замри — таймер запустится сам.",
      nextRu: "Собери кубик; убрал руки — таймер стартует, вернул — стоп.",
      activeButtonId: null,
    };
  }

  if (s.fsmState === "SOLVING") {
    return {
      step: "solving",
      titleRu: "Идёт сборка",
      nowRu: `Собирай. Идёт ${(s.solveElapsedMs / 1000).toFixed(1)} с.`,
      nextRu: "Верни руки в зоны и замри — таймер остановится.",
      activeButtonId: null,
    };
  }

  if (s.fsmState === "STOPPED") {
    return {
      step: "stopped",
      titleRu: "Сборка засчитана",
      nowRu: `Время: ${(s.solveElapsedMs / 1000).toFixed(3)} с. Нажми «Проверить сборку», покажи 6 граней.`,
      nextRu: "Потом «Новый разброс», чтобы пройти ещё раз.",
      activeButtonId: "btn-confirm",
    };
  }

  // Calibrated, light ok, no scramble prepared -> ready to run the accuracy gate.
  if (s.gateMode === "handmix") {
    return {
      step: "scrambleReady",
      titleRu: "Шаг 3 — перемешай руками и проверь зрение",
      nowRu:
        "Покрути кубик руками как угодно (без формул), потом нажми «Проверка точности» и покажи 6 граней.",
      nextRu: "Приложение само соберёт эталон и посчитает, насколько точно видит цвета.",
      activeButtonId: "btn-accuracy",
    };
  }
  return {
    step: "scrambleReady",
    titleRu: "Шаг 3 — покажи собранный кубик",
    nowRu: "Возьми собранный кубик, нажми «Проверка точности» и покажи 6 граней.",
    nextRu: "Сравню с эталоном собранного кубика и покажу точность.",
    activeButtonId: "btn-accuracy",
  };
}
