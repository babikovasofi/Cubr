// Flat last-layer diagram: the 3x3 U face plus the 12 side stickers (top row
// of F/R/B/L, the row that touches U) laid out as a "plus" around it — no
// solver, no 3D, drawn straight from a stored facelet string (pll.ts). No
// rotation, no animation (design-system §1, rule 4: rework elements don't
// spin) — this is a static recognition aid, shown once per draw.
//
// v1 shows color and position only (per the plan's "Out of scope": no
// permutation-arrow overlays). The side strips are placed on their
// geometrically correct edge (B above, F below, L left, R right, each
// aligned with U's matching row/column) but rotational continuity across
// each fold (exactly which corner of a strip touches which corner of U) is a
// good-faith rendering, not verified against one specific textbook diagram —
// the test battery checks each sticker's color against its OWN facelet index
// via data-* attributes, not the overall picture.
//
// Deliberate exception to design-system §1's "≤2 bright cube colors per
// component" rule, same class as HeroStickers: this IS a cube-face glyph,
// not a UI accent, so all 6 colors legitimately appear at once.

import { FACE_COLOR, type CubeFace } from "./cubeColors";

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

function uCell(facelets: string, i: number): Sticker {
  return { face: "U", slot: i, color: FACE_COLOR[facelets[U_START + i] as CubeFace] };
}
function sideCell(facelets: string, face: CubeFace, start: number, i: number): Sticker {
  return { face, slot: i, color: FACE_COLOR[facelets[start + i] as CubeFace] };
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

export default function LastLayerDiagram({
  facelets,
  caption,
  className = "",
}: {
  /** 54-char URFDLB facelet string, e.g. a PllCase's `facelets`. */
  facelets: string;
  /** Visible text under the diagram — the grid itself is aria-hidden. */
  caption: string;
  className?: string;
}) {
  const u = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => uCell(facelets, i));
  const f = [0, 1, 2].map((i) => sideCell(facelets, "F", F_START, i));
  const r = [0, 1, 2].map((i) => sideCell(facelets, "R", R_START, i));
  const l = [0, 1, 2].map((i) => sideCell(facelets, "L", L_START, i));
  const b = [0, 1, 2].map((i) => sideCell(facelets, "B", B_START, i));

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div aria-hidden className="grid grid-cols-5 grid-rows-5 gap-1">
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
      <p className="font-sans text-small text-muted">{caption}</p>
    </div>
  );
}
