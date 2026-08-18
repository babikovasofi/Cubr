// PLL recognition diagram: the flat last-layer grid (LastLayerGrid) colored
// with each sticker's REAL face color, straight from a stored facelet string
// (pll.ts). A PLL case's permutation is exactly what's being drilled — real
// colors on the side strips are the whole point (which piece sits where is
// the recognizable signal) — unlike OLL's diagram, see OllDiagram.tsx's
// header for why that one is binary instead.
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

import LastLayerGrid from "./LastLayerGrid";
import { FACE_COLOR, type CubeFace } from "./cubeColors";

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
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <LastLayerGrid facelets={facelets} colorFor={(ch) => FACE_COLOR[ch as CubeFace]} />
      <p className="font-sans text-small text-muted">{caption}</p>
    </div>
  );
}
