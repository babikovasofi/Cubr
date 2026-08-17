// Face-letter -> CSS color, for drawing a cube face (or last-layer diagram)
// straight from a facelet string. Deliberately NOT imported from
// vision/cubeState.ts's `Face` type — this file (and everything under
// src/trainer/, src/components/LastLayerDiagram.tsx) stays cubejs-free, so
// the local type is a plain 6-letter union, redundant with vision's but
// zero-coupling on purpose.
//
// White is a literal, not a token — same trap already documented at the top
// of HeroStickers.tsx: `--surface` inverts to near-black in dark mode, so a
// token-based "white" sticker would turn into an empty-looking dark square.
// The other five ride existing design tokens rather than inventing new
// colors, reusing HeroStickers' exact palette (§1: each cube color has one
// role; here that role is "this is literally that face's color").

export type CubeFace = "U" | "R" | "F" | "D" | "L" | "B";

export const FACE_COLOR: Record<CubeFace, string> = {
  U: "#FFFFFF",
  R: "var(--danger)",
  F: "var(--success)",
  D: "var(--warning)",
  L: "var(--live)",
  B: "var(--primary)",
};
