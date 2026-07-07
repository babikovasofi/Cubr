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

export interface MoveInfo {
  face: string; // single letter U/D/R/L/F/B
  suffix: "" | "'" | "2";
  faceRu: string; // "правый слой"
  directionRu: string; // human instruction
}

/** Parse a single scramble token like "R", "U'", "F2" into its parts. */
export function parseMove(token: string): MoveInfo {
  const face = token[0];
  const suffix = (token.slice(1) as "" | "'" | "2") || "";
  const faceRu = FACE_RU[face] ?? face;
  let directionRu: string;
  if (suffix === "2") {
    directionRu = "поверни на пол-оборота (×2), сторона неважна";
  } else if (suffix === "'") {
    directionRu = CCW_RU[face] ?? "поверни против часовой";
  } else {
    directionRu = CW_RU[face] ?? "поверни по часовой";
  }
  return { face, suffix, faceRu, directionRu };
}

/** One-line Russian instruction, e.g. "Правый слой: поверни от себя вверх." */
export function moveLabelRu(token: string): string {
  const m = parseMove(token);
  const faceCap = m.faceRu.charAt(0).toUpperCase() + m.faceRu.slice(1);
  return `${faceCap}: ${m.directionRu}.`;
}
