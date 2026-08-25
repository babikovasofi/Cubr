// PROTOTYPE — рисует ТОЛЬКО рамку-гайд с цветом по уверенности + подпись.
// Сознательно НЕ трогает vision/overlay.ts (задача требует не менять боевой
// файл) и не рисует зоны рук/landmarks — это отдельный, более узкий оверлей для
// демо-страницы. Геометрия рамки взята из vision/config.squareGuidePx (read-only
// импорт), чтобы жёлтый/зелёный квадрат совпадал с областью, которую реально
// читает readFace — тем же приёмом, что и в overlay.ts.
//
// Три цвета — уже существующие цвета приложения (не придуманы для прототипа):
// #ffd23f (жёлтый гайд, vision/overlay.ts), #39d98a (зелёный, тот же файл — зоны
// рук/успех), #ff5964 (красный, тот же файл — рука вне зоны).

import { squareGuidePx, type Rect } from "../vision/config";
import type { FrameStatus, BadReason } from "./goodFrame";

const YELLOW = { r: 0xff, g: 0xd2, b: 0x3f };
const GREEN = { r: 0x39, g: 0xd9, b: 0x8a };
const RED = { r: 0xff, g: 0x59, b: 0x64 };

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixColor(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
): string {
  return `rgb(${lerp(from.r, to.r, t)}, ${lerp(from.g, to.g, t)}, ${lerp(from.b, to.b, t)})`;
}

/** Жёлтый→зелёный по уверенности; красный — отдельная ветка для жёстких отказов. */
export function frameColor(status: FrameStatus, confidence: number, reason: BadReason | null): string {
  if (reason === "dark" || reason === "bright" || reason === "finger") {
    return `rgb(${RED.r}, ${RED.g}, ${RED.b})`;
  }
  if (status === "good") return `rgb(${GREEN.r}, ${GREEN.g}, ${GREEN.b})`;
  return mixColor(YELLOW, GREEN, confidence);
}

const STATUS_TEXT: Record<FrameStatus, string> = {
  seeking: "Наведи кубик в рамку",
  aligning: "Держи так…",
  good: "Есть кадр!",
};

const REASON_HINT: Record<BadReason, string> = {
  dark: "Слишком темно",
  bright: "Слишком светло / блик",
  finger: "Убери палец с грани",
  "no-lattice": "Наведи кубик в рамку",
};

export function statusText(status: FrameStatus, reason: BadReason | null): string {
  if (reason && reason !== "no-lattice") return REASON_HINT[reason];
  return STATUS_TEXT[status];
}

export interface DrawGoodFrameOpts {
  status: FrameStatus;
  confidence: number;
  reason: BadReason | null;
}

/** Рисует ТОЛЬКО квадрат-гайд с цветом по уверенности. Никаких зон рук. */
export function drawGoodFrameOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  guide: Rect,
  opts: DrawGoodFrameOpts,
): void {
  ctx.clearRect(0, 0, w, h);
  const g = squareGuidePx(guide, w, h);
  const color = frameColor(opts.status, opts.confidence, opts.reason);

  // Толщина растёт с уверенностью (2px..5px) — второй, менее заметный канал
  // сигнала вдобавок к цвету (доступность для дальтоников: не только hue).
  const lineWidth = 2 + Math.round(opts.confidence * 3);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(g.gx, g.gy, g.gw, g.gh);

  // U-edge метка, как в продукте.
  ctx.fillStyle = color;
  ctx.fillRect(g.gx, g.gy - 6, g.gw, 4);
}
