// cubejs wrapper: scramble generation, scramble -> expected facelet string,
// read-vs-expected diffing, and legal-string validation.
//
// FACELET ORDER (Kociemba / cubejs standard): URFDLB.
//   indices  0..8  = U face
//            9..17 = R face
//           18..26 = F face
//           27..35 = D face
//           36..44 = L face
//           45..53 = B face
// Within each face the 9 stickers are read LEFT-TO-RIGHT, TOP-TO-BOTTOM, i.e.
//
//        0 1 2
//        3 4 5      (index 4 is always the CENTER sticker of that face)
//        6 7 8
//
// Each character is a FACE LETTER (U R F D L B) naming the color of the center
// of the face that color belongs to. On a solved cube the string is
// "UUUUUUUUU RRRRRRRRR FFFFFFFFF DDDDDDDDD LLLLLLLLL BBBBBBBBB" (no spaces).
//
// CAPTURE ORIENTATION PROTOCOL (auto-oriented in cube.ts — plan #6):
//   The human roughly holds each of the 6 faces up to the overlay; exact
//   orientation is RECOVERED by code, in two steps:
//     (a) assignFacesByCenter — the CENTER sticker color names WHICH face this
//         capture is (U/R/F/D/L/B) via argmin ΔE vs the 6 refs. A center is a
//         solid color: it names the face but carries NO in-plane rotation.
//     (b) resolveRotations — each face's in-plane rotation (0/90/180/270) is
//         resolved by GLOBAL CONSISTENCY: brute-force all 4^6 rotation combos,
//         assemble the URFDLB string, keep the one cubejs validates as legal.
//   None / ambiguous -> FAIL LOUD (re-capture). index 4 (center) authoritatively
//   names the face's color; rotation is never guessed from a single center.

import Cube from "cubejs";

export type Facelet = string; // 54 chars over {U,R,F,D,L,B}
export const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACE_ORDER)[number];

export const SOLVED: Facelet =
  "UUUUUUUUU" + "RRRRRRRRR" + "FFFFFFFFF" + "DDDDDDDDD" + "LLLLLLLLL" + "BBBBBBBBB";

const MOVE_FACES = ["U", "R", "F", "D", "L", "B"];
const MOVE_SUFFIX = ["", "'", "2"];

/**
 * A random WCA-style scramble move sequence, e.g. "R U R' U' F2 ...".
 * Generated directly (no solver init needed): 25 moves, never same face twice
 * in a row, avoiding an immediate opposite-face redundancy.
 */
export function randomScramble(len = 25): string {
  const opp: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
  const moves: string[] = [];
  let prev = "";
  let prev2 = "";
  while (moves.length < len) {
    const face = MOVE_FACES[Math.floor(Math.random() * MOVE_FACES.length)];
    if (face === prev) continue;
    if (face === prev2 && opp[face] === prev) continue;
    const suffix = MOVE_SUFFIX[Math.floor(Math.random() * MOVE_SUFFIX.length)];
    moves.push(face + suffix);
    prev2 = prev;
    prev = face;
  }
  return moves.join(" ");
}

/**
 * Apply a scramble sequence to a solved cube and return the resulting facelet
 * string in URFDLB order. This is the GROUND TRUTH the accuracy harness diffs
 * against — never the tester's eyes.
 */
export function scrambleToFacelets(scramble: string): Facelet {
  const c = Cube.fromString(SOLVED);
  c.move(scramble);
  return c.asString();
}

/** A fresh random state's facelet string + the move sequence that makes it. */
export function randomStateFacelets(): { scramble: string; facelets: Facelet } {
  const c = Cube.random();
  return { scramble: c.solve(), facelets: c.asString() };
}

// ---------------------------------------------------------------------------
// Validation: is a 54-char string a LEGAL, parseable cube?
// ---------------------------------------------------------------------------

export interface Validation {
  ok: boolean;
  reason?: string;
  counts?: Record<Face, number>;
}

export function validateFacelets(s: Facelet): Validation {
  if (s.length !== 54) {
    return { ok: false, reason: `length ${s.length}, expected 54` };
  }
  const counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 } as Record<Face, number>;
  for (const ch of s) {
    if (!(ch in counts)) return { ok: false, reason: `bad char '${ch}'` };
    counts[ch as Face] += 1;
  }
  for (const f of FACE_ORDER) {
    if (counts[f] !== 9) {
      return { ok: false, reason: `color ${f} appears ${counts[f]}x, expected 9`, counts };
    }
  }
  // Centers must be identity (index 4,13,22,31,40,49 == U R F D L B).
  const centers = [4, 13, 22, 31, 40, 49];
  for (let k = 0; k < 6; k++) {
    if (s[centers[k]] !== FACE_ORDER[k]) {
      return {
        ok: false,
        reason: `center ${k} is '${s[centers[k]]}', expected '${FACE_ORDER[k]}'`,
        counts,
      };
    }
  }
  // Final gate: cubejs must accept it (checks permutation/orientation parity).
  try {
    const c = Cube.fromString(s);
    // asString round-trips only for legal cubes.
    if (c.asString() !== s) return { ok: false, reason: "cubejs round-trip mismatch", counts };
  } catch (e) {
    return { ok: false, reason: `cubejs rejected: ${(e as Error).message}`, counts };
  }
  return { ok: true, counts };
}

// ---------------------------------------------------------------------------
// Diff: read facelets vs expected -> concrete (face, index) mismatches
// ---------------------------------------------------------------------------

export interface Mismatch {
  face: Face;
  cellInFace: number; // 0..8
  globalIndex: number; // 0..53
  read: string;
  expected: string;
}

export function diffFacelets(read: Facelet, expected: Facelet): Mismatch[] {
  const out: Mismatch[] = [];
  const n = Math.min(read.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (read[i] !== expected[i]) {
      out.push({
        face: FACE_ORDER[Math.floor(i / 9)],
        cellInFace: i % 9,
        globalIndex: i,
        read: read[i],
        expected: expected[i],
      });
    }
  }
  return out;
}

/** Convenience: are the two facelet strings identical? */
export function facesMatch(read: Facelet, expected: Facelet): boolean {
  return read === expected;
}
