// Token -> plain-Russian direction, the SOURCE OF TRUTH for move direction.
// A twisty animation alone is ambiguous for a non-cuber (R vs R' looks the same
// depending on where you look); the text tells them exactly which layer and which
// way. Orientation is fixed by the banner: white up, green front.
//
// Notation: a letter = which layer, "'" = counter-clockwise, "2" = half turn (180°).
//   U up · D down · R right · L left · F front · B back.

const FACE_RU: Record<string, string> = {
  U: "верхний слой",
  D: "нижний слой",
  R: "правый слой",
  L: "левый слой",
  F: "передний слой",
  B: "задний слой",
};

// Direction of a clockwise (unprimed) quarter turn, described as the near part moves.
const CW_RU: Record<string, string> = {
  U: "поверни налево (если смотреть сверху)",
  D: "поверни направо (если смотреть снизу)",
  R: "поверни от себя вверх",
  L: "поверни на себя вверх",
  F: "поверни по часовой",
  B: "поверни против часовой",
};

const CCW_RU: Record<string, string> = {
  U: "поверни направо (если смотреть сверху)",
  D: "поверни налево (если смотреть снизу)",
  R: "поверни на себя вниз",
  L: "поверни от себя вниз",
  F: "поверни против часовой",
  B: "поверни по часовой",
};

import { translate } from "../i18n/t";

/** Переводчик; по умолчанию русский — то есть «вернуть ключ как есть». */
type T = (key: string, params?: Record<string, string | number>) => string;
const ruT: T = (key, params) => translate("ru", key, params);

export interface MoveInfo {
  face: string; // single letter U/D/R/L/F/B
  suffix: "" | "'" | "2";
  faceRu: string; // "правый слой"
  directionRu: string; // human instruction
}

/** Parse a single scramble token like "R", "U'", "F2" into its parts. */
export function parseMove(token: string, t: T = ruT): MoveInfo {
  const face = token[0];
  const suffix = (token.slice(1) as "" | "'" | "2") || "";
  const faceRu = t(FACE_RU[face] ?? face);
  let directionRu: string;
  if (suffix === "2") {
    directionRu = t("поверни на пол-оборота (×2), сторона неважна");
  } else if (suffix === "'") {
    directionRu = t(CCW_RU[face] ?? "поверни против часовой");
  } else {
    directionRu = t(CW_RU[face] ?? "поверни по часовой");
  }
  return { face, suffix, faceRu, directionRu };
}

/** One-line Russian instruction, e.g. "Правый слой: поверни от себя вверх." */
export function moveLabelRu(token: string, t: T = ruT): string {
  const m = parseMove(token, t);
  const faceCap = m.faceRu.charAt(0).toUpperCase() + m.faceRu.slice(1);
  return `${faceCap}: ${m.directionRu}.`;
}
