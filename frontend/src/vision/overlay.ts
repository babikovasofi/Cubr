// Overlay drawing + hand-zone geometry, split out of useHands so neither file
// exceeds the size budget. Pure canvas drawing — no MediaPipe, no React.
//
// MIRRORING (plan skeptic MED): the overlay <canvas> is CSS-mirrored (scaleX(-1))
// together with the <video>. All landmark/zone geometry here is in RAW frame
// coords (same space MediaPipe reports), so the CSS flip lines the drawing up
// with the mirrored video. Cyrillic labels are drawn inside a local horizontal
// flip so the text still reads forward on the mirrored canvas.

import { squareGuidePx, type Rect } from "./config";
import type { HandObservation } from "./hooks/useHands";

// Two zones at the bottom of the frame (left half / right half).
// Зоны рук подобраны вживую на dev-роуте /lab (владелец): левая — под реальную
// позу решения, правая — симметрично левой (зеркало через центр 0.5:
// x = 1 − 0.06 − 0.35 = 0.59). Узкая полоса чуть выше низа кадра, чтобы обычная
// поза сборки не заводила руки в зону раньше времени (лечит ранний стоп).
export function defaultZones(): { left: Rect; right: Rect } {
  return {
    left: { x: 0.06, y: 0.71, w: 0.35, h: 0.25 },
    right: { x: 0.59, y: 0.71, w: 0.35, h: 0.25 },
  };
}

export interface OverlayLabels {
  guide: string; // over the cube guide-rect, e.g. "Держи кубик здесь"
  left: string; // over the left hand zone
  right: string; // over the right hand zone
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  obs: HandObservation,
  zones: { left: Rect; right: Rect },
  guide: Rect,
  labels?: OverlayLabels,
): void {
  ctx.clearRect(0, 0, w, h);

  // Zones.
  for (const z of [zones.left, zones.right]) {
    ctx.strokeStyle = "#39d98a";
    ctx.lineWidth = 2;
    ctx.strokeRect(z.x * w, z.y * h, z.w * w, z.h * h);
  }

  // Guide frame for cube face. Draw the CENTERED SQUARE that readFace actually
  // samples (side = min of the guide px dims), so the yellow box the tester aligns
  // the cube to is EXACTLY the read region — a wider-than-square box would sample
  // the background in the side sticker columns (see useCubeReader.squareGuidePx).
  const g = squareGuidePx(guide, w, h);
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 3;
  ctx.strokeRect(g.gx, g.gy, g.gw, g.gh);
  // Mark the U-edge (top) so the tester knows which way is up.
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(g.gx, g.gy - 6, g.gw, 4);

  // Russian labels. Draw each inside a local horizontal-flip transform so the
  // text reads forward on the CSS-mirrored canvas. Anchor to the element's
  // post-mirror right edge ((x+w)*W) and flip so it lays out left-to-right.
  if (labels) {
    ctx.textBaseline = "bottom";
    ctx.font = "600 16px system-ui, sans-serif";
    const label = (text: string, x: number, y: number, color: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1); // cancel the CSS mirror locally
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label(labels.guide, g.gx + g.gw, g.gy - 8, "#ffd23f");
    label(labels.left, (zones.left.x + zones.left.w) * w, zones.left.y * h - 4, "#39d98a");
    label(labels.right, (zones.right.x + zones.right.w) * w, zones.right.y * h - 4, "#39d98a");
  }

  // Landmarks.
  for (const hand of obs.hands) {
    ctx.fillStyle = hand.inZone ? "#39d98a" : "#ff5964";
    for (const lm of hand.landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
