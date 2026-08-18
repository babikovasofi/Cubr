// Constructs a scramble for a chosen last-layer case (PLL or OLL) — no
// solver, no search. A case's state is DEFINED as "apply the case's
// algorithm's inverse to a solved cube" (see pll.ts's/oll.ts's headers and
// the plan's Design decisions), so:
//
//   scramble = [orientation prefix, if "any grip"] + invertAlg(case.alg) + AUF
//
// is correct BY CONSTRUCTION for any algorithm string — applying it to a
// solved cube always lands on exactly that case (proven independently by the
// test battery in tests/trainer/generate.test.ts and ollGenerate.test.ts, not
// trusted here). Zero cubejs import: this file only manipulates move-token
// strings.
//
// Generic over `ScrambleCase` (just `{ alg, facelets }`) rather than forked
// per case set: pll.ts's PllCase and oll.ts's OllCase both satisfy it
// structurally, and nothing below needs to know which one it's holding —
// PLL's "invert the solving algorithm, add an AUF" construction is exactly
// as correct for OLL (an OLL case is equally well-defined as "the state
// invertAlg(alg) produces from solved" — see oll.ts's header for the one
// place this generalization needed real care: OLL algorithms are NOT
// permutation-neutral the way this file's comments used to assume PLL's
// were, but that only affects what `facelets` looks like, not the
// construction below, which never inspects facelets at all).

/** The minimal shape `generateCaseScramble` needs — satisfied by both
 * `PllCase` and `OllCase` without either importing the other. */
export interface ScrambleCase {
  alg: string;
  facelets: string;
}

/** The four ways to finish a scramble on the U layer. */
export const AUFS = ["", "U", "U2", "U'"] as const;
export type Auf = (typeof AUFS)[number];

// All 24 proper rotations of a cube, as a whole-cube-rotation prefix: which
// face ends up on top (6 choices: "", x, x2, x', z, z') times which of the 4
// spins around the new vertical axis (y, y2, y', or none). Used only by the
// "any grip" toggle — see pll.ts / the plan's "AUF vs. whole-cube rotation"
// design note for why this is a genuinely different skill (color neutrality)
// and not just another AUF.
const UP_FACE_PREFIXES = ["", "x", "x2", "x'", "z", "z'"] as const;
const SPINS = ["", "y", "y2", "y'"] as const;

export const ORIENTATIONS: readonly string[] = UP_FACE_PREFIXES.flatMap((up) =>
  SPINS.map((spin) => [up, spin].filter(Boolean).join(" ")),
);

/**
 * Reverse token order, flip each token's direction (`R` <-> `R'`, `R2` stays
 * `R2`). Uniform across face/slice/rotation tokens (U R F D L B M E S x y z)
 * since they all share the same `'`/`2` suffix convention. Hand-rolled and
 * proven correct against the model directly (apply `alg` then
 * `invertAlg(alg)` to solved -> solved, for all 21 cases plus synthetic
 * strings covering x/y/z, M/S/E, and wide moves) rather than trusting
 * cubejs's own inverse — see generate.test.ts.
 */
export function invertAlg(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((tok) => {
      const face = tok[0];
      const suffix = tok.slice(1);
      if (suffix === "'") return face;
      if (suffix === "2") return `${face}2`;
      return `${face}'`;
    })
    .join(" ");
}

// A move's "turns" as a quarter-turn count mod 4 on its own face/axis: 0 = no
// turn, 1 = clockwise, 2 = half turn, 3 = counter-clockwise (== -1).
function turnsOf(token: string): number {
  const suffix = token.slice(1);
  if (suffix === "'") return 3;
  if (suffix === "2") return 2;
  return 1;
}
function tokenFromTurns(face: string, turns: number): string | null {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return null;
  if (t === 1) return face;
  if (t === 2) return `${face}2`;
  return `${face}'`;
}

/**
 * Collapse adjacent same-face/slice/rotation tokens into a single equivalent
 * move (or drop them if they cancel), e.g. `U U'` -> [], `U U` -> `U2`,
 * `R U U' R'` -> [] (transitively, once the middle pair collapses). Does NOT
 * reorder tokens or merge non-adjacent same-face moves (that would change
 * which case the sequence produces on a real cube, since intervening moves on
 * other faces are not commutative with it in general).
 */
export function simplifyMoves(tokens: readonly string[]): string[] {
  const stack: string[] = [];
  for (const tok of tokens) {
    const face = tok[0];
    const last = stack[stack.length - 1];
    if (last && last[0] === face) {
      stack.pop();
      const merged = tokenFromTurns(face, turnsOf(last) + turnsOf(tok));
      if (merged) stack.push(merged);
      // else: cancelled to nothing — do NOT re-push; this may expose a new
      // adjacent same-face pair (e.g. "R U U' R'"), so re-check by not
      // advancing past it — achieved by leaving the loop to continue: the
      // newly-exposed top of `stack` and the *next* incoming token are what
      // get compared on the following iteration, which handles the common
      // case. A single pass is sufficient here because tokens are consumed
      // left-to-right and each merge/cancel immediately updates the stack
      // top before the next token is considered.
    } else {
      stack.push(tok);
    }
  }
  return stack;
}

export interface GenerateOptions {
  /** Seeded RNG returning a value in [0, 1); defaults to Math.random. */
  rng?: () => number;
  /** Prefix a random whole-cube orientation (24-way) before the case. */
  anyGrip?: boolean;
}

/** Pick one case id from a non-empty list using `rng` (defaults to
 * Math.random). Generic over the id type so it works for `PllCaseId`,
 * `OllCaseId`, or a mixed array of both (they're disjoint string unions —
 * "OLL1".."OLL57" never collide with PLL's two-letter ids). */
export function pickCase<T extends string>(ids: readonly T[], rng: () => number = Math.random): T {
  if (ids.length === 0) throw new Error("pickCase: empty id list");
  const index = Math.floor(rng() * ids.length) % ids.length;
  return ids[index];
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const index = Math.floor(rng() * items.length) % items.length;
  return items[index];
}

/**
 * The scramble string for one draw of `caseDef`: orientation prefix (if
 * `anyGrip`) + invertAlg(case.alg) + a random AUF, simplified. Applying this
 * to a solved cube reproduces the case's `facelets` exactly (up to the AUF
 * and, with `anyGrip`, up to the chosen orientation) — see pll.ts's/oll.ts's
 * headers for why this is correct by construction, and generate.test.ts /
 * ollGenerate.test.ts for the proof against the model. Generic over
 * `ScrambleCase` — see this file's header for why PLL and OLL share this
 * unchanged rather than branching.
 */
export function generateCaseScramble<T extends ScrambleCase>(
  caseDef: T,
  options: GenerateOptions = {},
): string {
  const rng = options.rng ?? Math.random;
  const orientation = options.anyGrip ? pick(ORIENTATIONS, rng) : "";
  const auf = pick(AUFS, rng);
  const tokens = [orientation, invertAlg(caseDef.alg), auf]
    .filter(Boolean)
    .flatMap((part) => part.split(/\s+/).filter(Boolean));
  return simplifyMoves(tokens).join(" ");
}
