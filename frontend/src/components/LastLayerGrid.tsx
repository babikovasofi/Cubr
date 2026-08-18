// Shared flat last-layer grid layout: the 3x3 U face plus the 12 side
// stickers (top row of F/R/B/L, the row that touches U) laid out as a "plus"
// around it — no solver, no 3D, drawn straight from a stored facelet string.
// Extracted from LastLayerDiagram.tsx (the original PLL-only diagram) so
// OllDiagram.tsx can reuse the exact same layout with a different color
// policy, rather than forking the grid markup — the two diagrams differ ONLY
// in `colorFor` (real per-face colors for PLL vs. binary oriented/not for
// OLL; see OllDiagram.tsx's header for why).
//
// No rotation, no animation (design-system §1, rule 4) — a static
// recognition aid, shown once per draw. `aria-hidden`; the caller supplies a
// visible text caption alongside it.

import { type CubeFace } from "./cubeColors";

const U_START = 0;
const R_START = 9;
const F_START = 18;
const L_START = 36;
const B_START = 45;

interface Sticker {
  face: CubeFace;
  slot: number; // 0..8 for U, 0..2 for the side strips
  color: string;
}

function stickersFor(
  facelets: string,
  colorFor: (facelet: string) => string,
): { u: Sticker[]; f: Sticker[]; r: Sticker[]; l: Sticker[]; b: Sticker[] } {
  const uSlot = (i: number): Sticker => ({
    face: "U",
    slot: i,
    color: colorFor(facelets[U_START + i]),
  });
  const sideSlot = (face: CubeFace, start: number, i: number): Sticker => ({
    face,
    slot: i,
    color: colorFor(facelets[start + i]),
  });
  return {
    u: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(uSlot),
    f: [0, 1, 2].map((i) => sideSlot("F", F_START, i)),
    r: [0, 1, 2].map((i) => sideSlot("R", R_START, i)),
    l: [0, 1, 2].map((i) => sideSlot("L", L_START, i)),
    b: [0, 1, 2].map((i) => sideSlot("B", B_START, i)),
  };
}

const TILE = "h-6 w-6 rounded-sm border-2 border-ink";

function Cell({ sticker }: { sticker: Sticker | null }) {
  if (!sticker) return <span className="h-6 w-6" />;
  return (
    <span
      className={TILE}
      style={{ background: sticker.color }}
      data-testid="ll-sticker"
      data-face={sticker.face}
      data-slot={sticker.slot}
    />
  );
}

export default function LastLayerGrid({
  facelets,
  colorFor,
  className = "",
}: {
  /** 54-char URFDLB facelet string. */
  facelets: string;
  /** Maps a single facelet character to a CSS color — the only thing that
   * differs between LastLayerDiagram (PLL) and OllDiagram (OLL). */
  colorFor: (facelet: string) => string;
  className?: string;
}) {
  const { u, f, r, l, b } = stickersFor(facelets, colorFor);

  return (
    <div aria-hidden className={`grid grid-cols-5 grid-rows-5 gap-1 ${className}`}>
      <span className="h-6 w-6" />
      <Cell sticker={b[0]} />
      <Cell sticker={b[1]} />
      <Cell sticker={b[2]} />
      <span className="h-6 w-6" />

      <Cell sticker={l[0]} />
      <Cell sticker={u[0]} />
      <Cell sticker={u[1]} />
      <Cell sticker={u[2]} />
      <Cell sticker={r[0]} />

      <Cell sticker={l[1]} />
      <Cell sticker={u[3]} />
      <Cell sticker={u[4]} />
      <Cell sticker={u[5]} />
      <Cell sticker={r[1]} />

      <Cell sticker={l[2]} />
      <Cell sticker={u[6]} />
      <Cell sticker={u[7]} />
      <Cell sticker={u[8]} />
      <Cell sticker={r[2]} />

      <span className="h-6 w-6" />
      <Cell sticker={f[0]} />
      <Cell sticker={f[1]} />
      <Cell sticker={f[2]} />
      <span className="h-6 w-6" />
    </div>
  );
}
