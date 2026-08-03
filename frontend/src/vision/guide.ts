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

/**
 * Раскладка шести съёмок по шести цветам не сошлась.
 *
 * Одиночный argmin в этом месте говорил «центр U встретился 2 раза» — фраза
 * описывает свой внутренний конфликт, а не то, что человеку делать. Раскладка
 * целиком таких конфликтов не создаёт, поэтому отказ у неё ровно один и
 * конкретный: вот эта съёмка по счёту, вот цвет, который ей достался, вот
 * насколько её центр от него далёк. Дальше человек сам видит — показал грань
 * дважды или поймал в рамку стол.
 */
export function centerAssignFailedRu(
  capture: number,
  face: string,
  de: number,
  max: number,
  t: T = ruT,
): string {
  return t(
    "Съёмка {n} не опознана: её центр в {de} от цвета {face} (допустимо {max}). Либо одна и та же грань показана дважды, либо в рамку попал не кубик. Покажи шесть РАЗНЫХ граней, каждую — центром в рамку.",
    { n: String(capture + 1), de: de.toFixed(1), face, max: String(max) },
  );
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
