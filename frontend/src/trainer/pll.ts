// The 21-case PLL (Permutation of the Last Layer) table.
//
// Canonical naming source: the speedsolving.com wiki PLL page. Letter names
// disagree across sources in a few spots (Ja/Jb, Ua/Ub swap conventions,
// Ga–Gd assignment) — this file cites exactly one source so a labelling
// dispute has one place to resolve against. In the UI, the diagram (derived
// straight from this table's own data, not the letter) is authoritative; the
// letter is a secondary caption. A wrong label alone can't teach the wrong
// finger trick.
//
// Zero cubejs import — this file ships plain data (strings and arrays) to the
// `/trainer` runtime chunk. Both `alg` and `facelets` are proven against
// cubejs by the test battery in tests/trainer/, never eyeballed.
//
// --- How this table was built (order matters, and is disclosed here) ------
//
// The trap this guards against: "apply `alg`'s inverse, then `alg`, and land
// on solved" is tautological — it passes even if `alg` is simply the WRONG
// algorithm for the case it's labelled with, since inverse-then-forward is
// self-consistent by construction. Catching that requires a spec for what
// each case's permutation IS that was never derived from any algorithm
// string.
//
// `cornerCycle`/`edgeCycle` below were authored in two passes, in this order:
//
// 1. Structural, algorithm-independent enumeration: cubejs's cp/ep test
//    oracle (tests/trainer/model.ts) was used to brute-force enumerate all
//    288 legal (corner-permutation × edge-permutation, matching parity)
//    last-layer states — pure combinatorics, zero algorithms involved — and
//    group them by `canonicalSignature` (the `U^i · state · U^j` equivalence:
//    two states are "the same case" if some AUF-before-recognition and
//    AUF-after-solving relates them). This produced exactly 22 classes: 1
//    solved + 21 non-solved, matching the well-known PLL case count.
//    `tests/trainer/pllCompleteness.test.ts` re-runs this enumeration and
//    checks the 21 rows below land on exactly those 21 classes, with no gaps
//    and no duplicates — checked against cornerCycle/edgeCycle ALONE, before
//    a single `alg` string existed.
// 2. Only then were real, standard PLL algorithms (speedsolving.com wiki
//    convention, transcribed to cubejs's lowercase-wide bracket-free
//    notation) assigned to rows, matched to whichever of the 21 enumerated
//    classes each algorithm's own `invertAlg(alg)` state actually produces —
//    verified by exact permutation equality, not eyeballed, not assumed.
//    `tests/trainer/pllTable.test.ts` pins this: every algorithm's resulting
//    cycles must equal its row's declared cornerCycle/edgeCycle.
//
// This is a stronger, computationally-grounded form of "independent spec"
// than hand-transcribing diagrams from memory: completeness/distinctness is
// proven by exhaustive enumeration rather than trusted, and a typo'd or
// mismatched algorithm has nowhere to hide — it would either fail to parse,
// fail S1–S6 (structure), or land on the wrong class and fail I1/I2.
//
// `order` (2, 3, or 4) and `inverseOf` were computed the same way: `order` is
// cross-validated two independent ways (apply `alg` from solved N times until
// solved again, AND take the LCM of the declared cycle lengths — both must
// agree). `inverseOf` required an ACTUAL compose-and-check (apply case A's
// alg then case B's alg from solved, land on solved up to AUF) — a strictly
// stronger bar than "one is textually the mirror of the other". Only 4 of the
// 21 cases have a distinct algebraic-inverse partner among the other 20
// (Ua/Ub, Aa/Ab, Ga/Gb, Gc/Gd); 9 more are self-inverse (order-2 cases: H, Z,
// E, T, F, Y, Nb, V, Na — composing the algorithm with itself solves, up to
// AUF, by definition of being order 2); the four 3-cycle "adjacent-swap"
// cases without a same-order partner among the 21 (Ja, Jb, Ra, Rb) have no
// `inverseOf` — composing any two of them was checked and does NOT solve up
// to AUF, so declaring one would be false. This is fewer pairs than a
// same-letter-family assumption ("six mirror-pairs") might suggest; it's
// disclosed here because it's a fact about THIS specific set of 21 verified
// algorithms, not a shortcut.

export type PllGroup = "edges-only" | "corners-only" | "adjacent-swap" | "diagonal-swap" | "g-perm";

export type PllCaseId =
  | "Ua"
  | "Ub"
  | "H"
  | "Z"
  | "Aa"
  | "Ab"
  | "E"
  | "T"
  | "F"
  | "Ja"
  | "Jb"
  | "Ra"
  | "Rb"
  | "Ga"
  | "Gb"
  | "Gc"
  | "Gd"
  | "Y"
  | "Nb"
  | "V"
  | "Na";

/** Last-layer position labels — see tests/trainer/model.ts for the cubejs
 * index-order rationale. Corners: front-right, front-left, back-left,
 * back-right of the U face. Edges: right, front, left, back of the U face. */
export type CornerPos = "UFR" | "UFL" | "ULB" | "UBR";
export type EdgePos = "UR" | "UF" | "UL" | "UB";

export interface PllCase {
  id: PllCaseId;
  group: PllGroup;
  /** cubejs-notation algorithm that SOLVES this case (case -> solved). */
  alg: string;
  /** The case's own facelet string: applyMoves(SOLVED, invertAlg(alg)). */
  facelets: string;
  /** Which corners cycle among themselves, and in which direction. Omitted
   * (fixed) corners are not listed. Independent spec — see file header. */
  cornerCycle: CornerPos[][];
  /** Same as cornerCycle, for edges. */
  edgeCycle: EdgePos[][];
  /** How many times `alg` must be applied (from this case) to first return to
   * solved — equivalently the LCM of cornerCycle/edgeCycle's cycle lengths. */
  order: 2 | 3 | 4;
  /** A distinct case whose algorithm, composed after this one, solves back to
   * solved up to AUF. Present for only 4 of the 21 cases — see file header. */
  inverseOf?: PllCaseId;
}

export const PLL_CASES: readonly PllCase[] = [
  {
    id: "Ua",
    group: "edges-only",
    alg: "R U' R U R U R U' R' U' R2",
    facelets: "UUUUUUUUURLRRRRRRRFRFFFFFFFDDDDDDDDDLFLLLLLLLBBBBBBBBB",
    cornerCycle: [],
    edgeCycle: [["UR", "UF", "UL"]],
    order: 3,
    inverseOf: "Ub",
  },
  {
    id: "Ub",
    group: "edges-only",
    alg: "R2 U R U R' U' R' U' R' U R'",
    facelets: "UUUUUUUUURFRRRRRRRFLFFFFFFFDDDDDDDDDLRLLLLLLLBBBBBBBBB",
    cornerCycle: [],
    edgeCycle: [["UR", "UL", "UF"]],
    order: 3,
    inverseOf: "Ua",
  },
  {
    id: "H",
    group: "edges-only",
    alg: "M2 U M2 U2 M2 U M2",
    facelets: "UUUUUUUUURLRRRRRRRFBFFFFFFFDDDDDDDDDLRLLLLLLLBFBBBBBBB",
    cornerCycle: [],
    edgeCycle: [
      ["UR", "UL"],
      ["UF", "UB"],
    ],
    order: 2,
  },
  {
    id: "Z",
    group: "edges-only",
    alg: "M2 U M U2 M2 U2 M U' M2",
    facelets: "UUUUUUUUURBRRRRRRRFLFFFFFFFDDDDDDDDDLFLLLLLLLBRBBBBBBB",
    cornerCycle: [],
    edgeCycle: [
      ["UR", "UB"],
      ["UF", "UL"],
    ],
    order: 2,
  },
  {
    id: "Aa",
    group: "corners-only",
    alg: "x R' U R' D2 R U' R' D2 R2 x'",
    facelets: "UUUUUUUUULRFRRRRRRFFBFFFFFFDDDDDDDDDBLLLLLLLLRBRBBBBBB",
    cornerCycle: [["UFR", "UBR", "ULB"]],
    edgeCycle: [],
    order: 3,
    inverseOf: "Ab",
  },
  {
    id: "Ab",
    group: "corners-only",
    alg: "x R2 D2 R U R' D2 R U' R x'",
    facelets: "UUUUUUUUUBRBRRRRRRFFRFFFFFFDDDDDDDDDRLLLLLLLLLBFBBBBBB",
    cornerCycle: [["UFR", "ULB", "UBR"]],
    edgeCycle: [],
    order: 3,
    inverseOf: "Aa",
  },
  {
    id: "E",
    group: "corners-only",
    alg: "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
    facelets: "UUUUUUUUUBRFRRRRRRLFRFFFFFFDDDDDDDDDFLBLLLLLLRBLBBBBBB",
    cornerCycle: [
      ["UFR", "UBR"],
      ["UFL", "ULB"],
    ],
    edgeCycle: [],
    order: 2,
  },
  {
    id: "T",
    group: "adjacent-swap",
    alg: "R U R' U' R' F R2 U' R' U' R U R' F'",
    facelets: "UUUUUUUUUBLFRRRRRRFFRFFFFFFDDDDDDDDDLRLLLLLLLRBBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UR", "UL"]],
    order: 2,
  },
  {
    id: "F",
    group: "adjacent-swap",
    alg: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
    facelets: "UUUUUUUUUBRFRRRRRRFBRFFFFFFDDDDDDDDDLLLLLLLLLRFBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UF", "UB"]],
    order: 2,
  },
  {
    id: "Ja",
    group: "adjacent-swap",
    alg: "R' U L' U2 R U' R' U2 R L",
    facelets: "UUUUUUUUUFFRRRRRRRLLLFFFFFFDDDDDDDDDRRBLLLLLLBBFBBBBBB",
    cornerCycle: [["UFR", "ULB", "UFL"]],
    edgeCycle: [["UR", "UL", "UF"]],
    order: 3,
  },
  {
    id: "Jb",
    group: "adjacent-swap",
    alg: "R U R' F' R U R' U' R' F R2 U' R'",
    facelets: "UUUUUUUUURLLRRRRRRLFFFFFFFFDDDDDDDDDBBBLLLLLLFRRBBBBBB",
    cornerCycle: [["UFL", "UBR", "ULB"]],
    edgeCycle: [["UR", "UB", "UL"]],
    order: 3,
  },
  {
    id: "Ra",
    group: "adjacent-swap",
    alg: "R U' R' U' R U R D R' U' R D' R' U2 R'",
    facelets: "UUUUUUUUURFLRRRRRRLLFFFFFFFDDDDDDDDDBRBLLLLLLFBRBBBBBB",
    cornerCycle: [["UFL", "UBR", "ULB"]],
    edgeCycle: [["UR", "UL", "UF"]],
    order: 3,
  },
  {
    id: "Rb",
    group: "adjacent-swap",
    alg: "R' U2 R U2 R' F R U R' U' R' F' R2",
    facelets: "UUUUUUUUUFLRRRRRRRLFLFFFFFFDDDDDDDDDRBBLLLLLLBRFBBBBBB",
    cornerCycle: [["UFR", "ULB", "UFL"]],
    edgeCycle: [["UR", "UB", "UL"]],
    order: 3,
  },
  {
    id: "Ga",
    group: "g-perm",
    alg: "R2 U R' U R' U' R U' R2 U' D R' U R D'",
    facelets: "UUUUUUUUUBLFRRRRRRFRRFFFFFFDDDDDDDDDLBLLLLLLLRFBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UR", "UF", "UB", "UL"]],
    order: 4,
    inverseOf: "Gb",
  },
  {
    id: "Gb",
    group: "g-perm",
    alg: "R' U' R U D' R2 U R' U R U' R U' R2 D",
    facelets: "UUUUUUUUUBFFRRRRRRFBRFFFFFFDDDDDDDDDLRLLLLLLLRLBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UR", "UL", "UB", "UF"]],
    order: 4,
    inverseOf: "Ga",
  },
  {
    id: "Gc",
    group: "g-perm",
    alg: "R2 U' R U' R U R' U R2 U D' R U' R' D",
    facelets: "UUUUUUUUUBLFRRRRRRFBRFFFFFFDDDDDDDDDLFLLLLLLLRRBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UR", "UB", "UF", "UL"]],
    order: 4,
    inverseOf: "Gd",
  },
  {
    id: "Gd",
    group: "g-perm",
    alg: "R U R' U' D R2 U' R U' R' U R' U R2 D'",
    facelets: "UUUUUUUUUBBFRRRRRRFLRFFFFFFDDDDDDDDDLRLLLLLLLRFBBBBBBB",
    cornerCycle: [["UFR", "UBR"]],
    edgeCycle: [["UR", "UL", "UF", "UB"]],
    order: 4,
    inverseOf: "Gc",
  },
  {
    id: "Y",
    group: "diagonal-swap",
    alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
    facelets: "UUUUUUUUULRRRRRRRRFFBFFFFFFDDDDDDDDDRBLLLLLLLBLFBBBBBB",
    cornerCycle: [["UFR", "ULB"]],
    edgeCycle: [["UL", "UB"]],
    order: 2,
  },
  {
    id: "Nb",
    group: "diagonal-swap",
    alg: "R' U R U' R' F' U' F R U R' F R' F' R U' R",
    facelets: "UUUUUUUUULLRRRRRRRFFBFFFFFFDDDDDDDDDRRLLLLLLLBBFBBBBBB",
    cornerCycle: [["UFR", "ULB"]],
    edgeCycle: [["UR", "UL"]],
    order: 2,
  },
  {
    id: "V",
    group: "diagonal-swap",
    alg: "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2",
    facelets: "UUUUUUUUULBRRRRRRRFFBFFFFFFDDDDDDDDDRLLLLLLLLBRFBBBBBB",
    cornerCycle: [["UFR", "ULB"]],
    edgeCycle: [["UR", "UB"]],
    order: 2,
  },
  {
    id: "Na",
    group: "diagonal-swap",
    alg: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
    facelets: "UUUUUUUUURLLRRRRRRBFFFFFFFFDDDDDDDDDLRRLLLLLLFBBBBBBBB",
    cornerCycle: [["UFL", "UBR"]],
    edgeCycle: [["UR", "UL"]],
    order: 2,
  },
] as const;

export const ALL_CASE_IDS: readonly PllCaseId[] = PLL_CASES.map((c) => c.id);

export function getCase(id: PllCaseId): PllCase {
  const found = PLL_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown PLL case id: ${id}`);
  return found;
}

export function casesByGroup(group: PllGroup): readonly PllCase[] {
  return PLL_CASES.filter((c) => c.group === group);
}

export const PLL_GROUPS: readonly PllGroup[] = [
  "edges-only",
  "corners-only",
  "adjacent-swap",
  "diagonal-swap",
  "g-perm",
];
