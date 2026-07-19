// Result share card (plan: result-share-card). Hand-drawn on a 1080x1080 2D
// <canvas> — deliberately NOT html2canvas/dom-to-image/satori (no new dep, no
// DOM-snapshot lib, see plan Out of scope). ctx is injected into
// drawResultCard so it's unit-testable without a real <canvas>.
//
// Privacy: CardData never carries winner_id/UUID/email — callers (ResultScreen,
// DuelResult) build it from already-on-screen strings only (see their own
// comments).

export type Ctx2D = CanvasRenderingContext2D;

export interface CardData {
  kind: "solo" | "duel";
  timeLabel: string; // formatted seconds, e.g. "12.34" — ignored when dnf/duel
  dnf: boolean;
  scramble: string;
  dateLabel: string;
  duel?: {
    outcome: string; // on-screen outcome label (Ничья / Ты выиграл / Не в этот раз)
    you: string; // formatted time string
    opponent: string; // formatted time string
  };
}

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  ink: string;
  muted: string;
  primary: string;
  success: string;
  danger: string;
}

// Hardcoded light-theme defaults (index.css :root) — used whenever a CSS var
// resolves empty (jsdom, or a render that races document mount), so fillStyle
// is never set to ''.
const DEFAULT_PALETTE: Palette = {
  bg: "#FBF8F1",
  surface: "#FFFFFF",
  surfaceAlt: "#F3EDE0",
  line: "#EDE5D6",
  ink: "#221E17",
  muted: "#8A8172",
  primary: "#0051BA",
  success: "#009E60",
  danger: "#C41E3A",
};

function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  // var(--x) is NOT a valid canvas fillStyle — resolve the live custom
  // property to its computed value (theme-aware: .dark swaps the values).
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw === "" ? fallback : raw;
}

// Re-read every call (never cached) so a theme toggle between renders is honored.
export function resolvePalette(): Palette {
  return {
    bg: token("--bg", DEFAULT_PALETTE.bg),
    surface: token("--surface", DEFAULT_PALETTE.surface),
    surfaceAlt: token("--surface-2", DEFAULT_PALETTE.surfaceAlt),
    line: token("--line", DEFAULT_PALETTE.line),
    ink: token("--ink", DEFAULT_PALETTE.ink),
    muted: token("--muted", DEFAULT_PALETTE.muted),
    primary: token("--primary", DEFAULT_PALETTE.primary),
    success: token("--success", DEFAULT_PALETTE.success),
    danger: token("--danger", DEFAULT_PALETTE.danger),
  };
}

const SIZE = 1080;
const PADDING = 64;
const BORDER = 6;
const SHADOW = 10;

// Exact weight/size/family strings drawn below — ensureFonts() loads these
// verbatim so fillText doesn't race the @import in index.css. In-string
// fallback stacks (Helvetica/Arial, Courier New/monospace) keep the card
// legible even if the Google Fonts request is slow or blocked.
const FONT_WORDMARK = '800 40px "Rubik", "Helvetica Neue", Arial, sans-serif';
const FONT_OVERLINE = '700 28px "Rubik", "Helvetica Neue", Arial, sans-serif';
const FONT_OUTCOME = '800 56px "Rubik", "Helvetica Neue", Arial, sans-serif';
const FONT_LABEL = '700 24px "Rubik", "Helvetica Neue", Arial, sans-serif';
const FONT_DATE = '500 24px "Rubik", "Helvetica Neue", Arial, sans-serif';
const FONT_TIME_LG = '600 160px "IBM Plex Mono", "Courier New", monospace';
const FONT_TIME_MD = '600 64px "IBM Plex Mono", "Courier New", monospace';
const FONT_SCRAMBLE = '400 30px "IBM Plex Mono", "Courier New", monospace';

const DRAWN_FONTS = [
  FONT_WORDMARK,
  FONT_OVERLINE,
  FONT_OUTCOME,
  FONT_LABEL,
  FONT_DATE,
  FONT_TIME_LG,
  FONT_TIME_MD,
  FONT_SCRAMBLE,
];

// A font-load failure must not block the card — the in-string fallback stacks
// above keep it legible, so this only ever best-effort speeds up the first paint.
export async function ensureFonts(): Promise<void> {
  if (!document.fonts?.load) return;
  try {
    await Promise.all(DRAWN_FONTS.map((font) => document.fonts.load(font)));
  } catch {
    // ignore — see comment above
  }
}

// Manual word-wrap: canvas has no text-wrap, so break on whitespace (scrambles
// are space-separated moves) once a line would overflow maxWidth.
function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(attempt).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function drawResultCard(ctx: Ctx2D, data: CardData, palette: Palette): void {
  ctx.clearRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const cardW = SIZE - PADDING * 2;
  const cardH = SIZE - PADDING * 2;

  // Sticker panel: offset ink block behind a bordered surface — the same
  // motif Button/ResultScreen use on-screen (box-shadow 3px 3px 0 var(--ink)),
  // built from flat rects so it stays trivially mockable in tests.
  ctx.fillStyle = palette.ink;
  ctx.fillRect(PADDING + SHADOW, PADDING + SHADOW, cardW, cardH);
  ctx.fillRect(PADDING, PADDING, cardW, cardH);
  ctx.fillStyle = palette.surface;
  ctx.fillRect(PADDING + BORDER, PADDING + BORDER, cardW - BORDER * 2, cardH - BORDER * 2);

  const innerX = PADDING + BORDER + 56;
  const innerRight = PADDING + cardW - BORDER - 56;
  const innerWidth = innerRight - innerX;

  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = palette.primary;
  ctx.font = FONT_WORDMARK;
  ctx.textAlign = "left";
  ctx.fillText("Cubr", innerX, PADDING + BORDER + 90);

  ctx.fillStyle = palette.muted;
  ctx.font = FONT_OVERLINE;
  ctx.textAlign = "center";
  ctx.fillText(data.kind === "duel" ? "ДУЭЛЬ" : "СОЛО", SIZE / 2, PADDING + BORDER + 190);

  let cursorY = PADDING + BORDER + 330;

  if (data.kind === "duel" && data.duel) {
    ctx.fillStyle = palette.ink;
    ctx.font = FONT_OUTCOME;
    ctx.textAlign = "center";
    ctx.fillText(data.duel.outcome, SIZE / 2, cursorY);
    cursorY += 80;

    const gap = 40;
    const colW = (innerWidth - gap) / 2;
    const colH = 220;
    const colY = cursorY;
    const leftX = innerX;
    const rightX = innerX + colW + gap;

    ctx.fillStyle = palette.surfaceAlt;
    ctx.fillRect(leftX, colY, colW, colH);
    ctx.fillRect(rightX, colY, colW, colH);

    ctx.fillStyle = palette.muted;
    ctx.font = FONT_LABEL;
    ctx.textAlign = "center";
    ctx.fillText("ТЫ", leftX + colW / 2, colY + 50);
    ctx.fillText("СОПЕРНИК", rightX + colW / 2, colY + 50);

    ctx.fillStyle = palette.ink;
    ctx.font = FONT_TIME_MD;
    ctx.fillText(data.duel.you, leftX + colW / 2, colY + 150);
    ctx.fillText(data.duel.opponent, rightX + colW / 2, colY + 150);

    cursorY = colY + colH + 90;
  } else {
    ctx.textAlign = "center";
    ctx.font = FONT_TIME_LG;
    ctx.fillStyle = data.dnf ? palette.danger : palette.ink;
    ctx.fillText(data.dnf ? "DNF" : data.timeLabel, SIZE / 2, cursorY + 60);
    cursorY += 220;
  }

  ctx.font = FONT_SCRAMBLE;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "left";
  const scrambleLineHeight = 42;
  const maxScrambleLines = 6;
  const scrambleLines = wrapText(ctx, data.scramble, innerWidth).slice(0, maxScrambleLines);
  scrambleLines.forEach((line, i) => {
    ctx.fillText(line, innerX, cursorY + i * scrambleLineHeight);
  });

  ctx.font = FONT_DATE;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "left";
  ctx.fillText(data.dateLabel, innerX, PADDING + cardH - BORDER - 56);
}

export async function renderCardBlob(data: CardData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  await ensureFonts();
  const palette = resolvePalette();
  drawResultCard(ctx, data, palette);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob null"));
    }, "image/png");
  });
}
