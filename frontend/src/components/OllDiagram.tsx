// OLL recognition diagram: the same flat last-layer grid LastLayerDiagram
// uses (LastLayerGrid), but colored BINARY — oriented (this sticker's own
// face is showing, i.e. facelet === "U") or not — rather than each
// sticker's real per-face color.
//
// Why binary, unlike PLL's diagram: an OLL case is defined by ORIENTATION
// alone (oll.ts's header); a genuine OLL algorithm is free to permute the
// last layer while fixing it (PLL cleans that up next regardless), so the
// specific R/F/L/B colors sitting in a stored OLL case's `facelets` are
// algorithm-incidental — which piece happens to end up where after THIS
// particular algorithm, not something a solver's physical (pre-OLL, F2L-
// solved-but-last-layer-scrambled) cube will match. Rendering them as real
// colors, the way LastLayerDiagram does for PLL, would teach a signal that
// isn't there. What IS diagnostic — and is exactly what every printed OLL
// reference chart shows — is binary: which stickers are already showing
// their own face (the top-face-oriented ones, plus any side sticker that
// happens to be "supposed to be on top") vs. everything else.
//
// Color choice: "oriented" reuses FACE_COLOR.U (this app's own white-topped
// SOLVED convention — see cubeColors.ts's header for why U is white, not
// yellow, in this facelet model) rather than inventing a new "yellow" swatch
// that doesn't correspond to any token this app already uses for the U face.
// "Not yet oriented" is `surface-2` (§2: secondary fill / "blank" role) —
// neutral, not an error state.

import LastLayerGrid from "./LastLayerGrid";
import { FACE_COLOR } from "./cubeColors";

const ORIENTED = FACE_COLOR.U;
const UNORIENTED = "var(--surface-2)";

function colorFor(facelet: string): string {
  return facelet === "U" ? ORIENTED : UNORIENTED;
}

export default function OllDiagram({
  facelets,
  caption,
  className = "",
}: {
  /** 54-char URFDLB facelet string, e.g. an OllCase's `facelets`. */
  facelets: string;
  /** Visible text under the diagram — the grid itself is aria-hidden. */
  caption: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <LastLayerGrid facelets={facelets} colorFor={colorFor} />
      <p className="font-sans text-small text-muted">{caption}</p>
    </div>
  );
}
