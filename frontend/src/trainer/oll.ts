// The 57-case OLL (Orientation of the Last Layer) table.
//
// Canonical numbering source: the classic 1-57 OLL numbering used across the
// speedcubing community (speedsolving.com wiki's OLL page, cited here as the
// one source a labelling dispute resolves against — same policy as pll.ts).
// Nicknames (Sune, Antisune, Bowtie, Dot-shape names, …) come from the same
// page and are carried as `name`, but `id`/`number` (1–57) are what this file
// treats as authoritative — see the header note on `name` below.
//
// Zero cubejs import — plain data (strings, arrays, numbers) shipped to the
// `/trainer` runtime chunk, exactly like pll.ts. `alg` and `facelets` are
// proven against cubejs by the test battery in tests/trainer/, never
// eyeballed.
//
// --- How this table was built (order matters, and is disclosed here) ------
//
// OLL is defined by ORIENTATION alone: how the 4 last-layer corners are
// twisted (3 states each: 0 = correctly oriented, 1/2 = twisted one way or
// the other) and how the 4 last-layer edges are flipped (2 states each: 0 =
// correctly oriented, 1 = flipped) — permutation (which piece sits where)
// plays no part; that is PLL's job, done afterward. This is a DIFFERENT
// independent variable than pll.ts's corner/edge permutation cycles, so the
// construction below generalizes pll.ts's two-phase method rather than
// reusing its cycle machinery directly:
//
// 1. Structural, algorithm-independent enumeration: with conservation laws
//    (corner twists sum to 0 mod 3, edge flips sum to 0 mod 2 — a physical
//    invariant of any legal cube state) there are exactly 3^3 x 2^3 = 216
//    legal (corner-orientation x edge-orientation) last-layer states —
//    pure combinatorics, zero algorithms involved. Grouping by
//    `canonicalOllSignature` (the single-turn-of-U equivalence: two states
//    are "the same case" if some U/U2/U' view of one equals the other —
//    see model.ts's header for why this is a 4-way, not 16-way, group
//    unlike PLL's permutation cycles) produces exactly 58 classes: 1 solved
//    + 57 non-solved, the well-known OLL case count.
//    `tests/trainer/ollCompleteness.test.ts` re-runs this enumeration and
//    checks the 57 rows below land on exactly those 57 classes, with no gaps
//    and no duplicates — checked against cornerTwist/edgeFlip ALONE, before
//    a single `alg` string existed in this file.
// 2. Only then were real, standard OLL algorithms (speedsolving.com wiki
//    convention, transcribed to cubejs's lowercase-wide bracket-free
//    notation) assigned to rows, matched to whichever of the 57 enumerated
//    classes each algorithm's own `invertAlg(alg)` state actually produces —
//    verified by exact corner-twist/edge-flip equality, not eyeballed.
//    `tests/trainer/ollTable.test.ts` pins this: every algorithm's resulting
//    orientation must equal its row's declared cornerTwist/edgeFlip.
//
// This closes the same trap pll.ts's header describes: "apply `alg`'s
// inverse, then `alg`, and land on solved" is tautological on its own and
// would pass even for a wrong algorithm, since inverse-then-forward is
// self-consistent by construction. The independent spec, written and proven
// complete BEFORE any algorithm existed, is what actually catches a
// mismatched or mistyped algorithm.
//
// --- A real surprise found while building this (documented, not hidden) --
//
// pll.ts's build assumed real PLL algorithms are "permutation-neutral" the
// same way OLL algorithms are "orientation-only" — an assumption that does
// NOT carry over. A genuine OLL algorithm is only required to fix
// ORIENTATION; it is free to permute the last-layer pieces along the way
// (PLL cleans that up next regardless), and in practice every one of these
// 57 standard algorithms DOES leave a non-identity permutation behind when
// run in isolation from a solved cube. This is why `facelets` below is NOT
// used to derive the independent spec (unlike a naive port of pll.ts's
// approach might try) — cornerTwist/edgeFlip alone are the case's identity;
// `facelets`'s specific non-U colors are algorithm-incidental and the
// diagram (OllDiagram, unlike PLL's LastLayerDiagram) deliberately does not
// render them as real colors — see OllDiagram.tsx's header.
//
// --- `group` -----------------------------------------------------------
//
// Purely structural (derived from the independent spec, not a hand-picked
// visual "shape" name, which would carry the same eyeballing risk this whole
// file exists to avoid): "corners-only" = all 4 edges already oriented, only
// corners need twisting (7 cases — the classic 2-look-OLL "OCLL" set,
// includes Sune/Antisune); "edges-only" = all 4 corners already oriented,
// only edges need flipping (3 cases); "mixed" = both (47 cases, the
// majority). Counts (7 + 3 + 47 = 57) are asserted in ollCompleteness's
// sibling table test, not just claimed here.
//
// --- `name` --------------------------------------------------------------
//
// Community nicknames are real but informally sourced (one wiki page,
// unlike `alg`/`facelets` which are proven against cubejs) — treat `name` as
// a recognition aid, `id`/`number` as the authoritative identifier. A wrong
// or disputed nickname is cosmetic; the diagram (built from the proven
// cornerTwist/edgeFlip, same policy as pll.ts) is what actually teaches the
// case.

export type OllGroup = "corners-only" | "edges-only" | "mixed";

export type OllCaseId =
  | "OLL1"
  | "OLL2"
  | "OLL3"
  | "OLL4"
  | "OLL5"
  | "OLL6"
  | "OLL7"
  | "OLL8"
  | "OLL9"
  | "OLL10"
  | "OLL11"
  | "OLL12"
  | "OLL13"
  | "OLL14"
  | "OLL15"
  | "OLL16"
  | "OLL17"
  | "OLL18"
  | "OLL19"
  | "OLL20"
  | "OLL21"
  | "OLL22"
  | "OLL23"
  | "OLL24"
  | "OLL25"
  | "OLL26"
  | "OLL27"
  | "OLL28"
  | "OLL29"
  | "OLL30"
  | "OLL31"
  | "OLL32"
  | "OLL33"
  | "OLL34"
  | "OLL35"
  | "OLL36"
  | "OLL37"
  | "OLL38"
  | "OLL39"
  | "OLL40"
  | "OLL41"
  | "OLL42"
  | "OLL43"
  | "OLL44"
  | "OLL45"
  | "OLL46"
  | "OLL47"
  | "OLL48"
  | "OLL49"
  | "OLL50"
  | "OLL51"
  | "OLL52"
  | "OLL53"
  | "OLL54"
  | "OLL55"
  | "OLL56"
  | "OLL57";

/** Last-layer position labels — same 4 corner / 4 edge U-layer slots as
 * pll.ts's CornerPos/EdgePos (see tests/trainer/model.ts for the cubejs
 * index-order rationale), reused here as the positions orientation is
 * attached to. */
export type OllCornerPos = "UFR" | "UFL" | "ULB" | "UBR";
export type OllEdgePos = "UR" | "UF" | "UL" | "UB";

/** One corner's twist away from correctly-oriented: 1 or 2 (0 = omitted —
 * see cornerTwist below). Direction (1 vs 2) is not given semantic meaning
 * here (cw/ccw); it only has to be internally consistent, which the model
 * test battery checks structurally, not by label. */
export type CornerTwist = 1 | 2;

export interface OllCase {
  id: OllCaseId;
  /** Community-standard case number, 1–57 — same value encoded in `id`. */
  number: number;
  /** Recognition nickname — see the file header's `name` note. */
  name: string;
  group: OllGroup;
  /** cubejs-notation algorithm that SOLVES this case (case -> solved). */
  alg: string;
  /** The case's own facelet string: applyMoves(SOLVED, invertAlg(alg)). Its
   * non-U-face colors are algorithm-incidental (see file header) — never
   * read for case identity, only for pinning `alg` against drift. */
  facelets: string;
  /** Which corners are twisted away from correct, and by how much. Corners
   * not listed are correctly oriented (twist 0). Independent spec — derived
   * from structural enumeration, not from `alg` — see file header. */
  cornerTwist: { pos: OllCornerPos; twist: CornerTwist }[];
  /** Which edges are flipped away from correct. Edges not listed are
   * correctly oriented. Same independent-spec policy as cornerTwist. */
  edgeFlip: OllEdgePos[];
}

export const OLL_CASES: readonly OllCase[] = [
  {
    id: "OLL1",
    number: 1,
    name: "Runway",
    group: "mixed",
    alg: "R U2 R2 F R F' U2 R' F R F'",
    facelets: "BLFBUFRRRUUURRRRRRFUBFFFFFFDDDDDDDDDUUULLLLLLLULBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL2",
    number: 2,
    name: "Zamboni",
    group: "mixed",
    alg: "R U' R2 D' r U r' D R2 U R'",
    facelets: "FLFRUFBBBRUURRRRRRUUUFFFFFFDDDDDDDDDUULLLLLLLLURBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL3",
    number: 3,
    name: "Anti-Pinwheel",
    group: "mixed",
    alg: "f R U R' U' f' U' F R U R' U' F'",
    facelets: "BBRLUFLRUFUURRRRRRBULFFFFFFDDDDDDDDDRUULLLLLLFUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL4",
    number: 4,
    name: "Pinwheel",
    group: "mixed",
    alg: "f R U R' U' f' U F R U R' U' F'",
    facelets: "LLUBURFFRUUBRRRRRRUUBFFFFFFDDDDDDDDDUURLLLLLLLUFBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL5",
    number: 5,
    name: "Lefty Square",
    group: "mixed",
    alg: "r' U2 R U R' U r",
    facelets: "RRFBUUBUULLURRRRRRRFBFFFFFFDDDDDDDDDFUULLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL6",
    number: 6,
    name: "Righty Square",
    group: "mixed",
    alg: "r U2 R' U' R U' r'",
    facelets: "FUUFUURRBULLRRRRRRUULFFFFFFDDDDDDDDDUUBLLLLLLFBRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL7",
    number: 7,
    name: "Lightning",
    group: "mixed",
    alg: "r U R' U R U2 r'",
    facelets: "RUFUUFULLBUURRRRRRBUUFFFFFFDDDDDDDDDFRRLLLLLLLBUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL8",
    number: 8,
    name: "Reverse Lightning",
    group: "mixed",
    alg: "l' U' L U' L' U2 l",
    facelets: "FULFUURRULLFRRRRRRUUBFFFFFFDDDDDDDDDUUBLLLLLLUBRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL9",
    number: 9,
    name: "Kite",
    group: "mixed",
    alg: "R U R' U' R' F R2 U R' U' F'",
    facelets: "FURUUFBBUFUBRRRRRRUULFFFFFFDDDDDDDDDULLLLLLLLURRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL10",
    number: 10,
    name: "Anti-Kite",
    group: "mixed",
    alg: "R U R' U R' F R F' R U2 R'",
    facelets: "BBUUURRUFLUBRRRRRRFFUFFFFFFDDDDDDDDDRLULLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL11",
    number: 11,
    name: "Downstairs",
    group: "mixed",
    alg: "r' R2 U R' U R U2 R' U M'",
    facelets: "FLLBUUUUBRRURRRRRRRFUFFFFFFDDDDDDDDDLUFLLLLLLBUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL12",
    number: 12,
    name: "Upstairs",
    group: "mixed",
    alg: "r R2 U' R U' R' U2 R U' r' R",
    facelets: "UUFFUUBLLURRRRRRRRUUFFFFFFFDDDDDDDDDBULLLLLLLUBRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL13",
    number: 13,
    name: "Gun",
    group: "mixed",
    alg: "F U R U2 R' U' R U R' F'",
    facelets: "FFRUUUULLBBURRRRRRBUUFFFFFFDDDDDDDDDLRRLLLLLLFUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL14",
    number: 14,
    name: "Anti-Gun",
    group: "mixed",
    alg: "R' F R U R' F' R F U' F'",
    facelets: "RFLUUUBRURBFRRRRRRUUFFFFFFFDDDDDDDDDULLLLLLLLUUBBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL15",
    number: 15,
    name: "Squeegee",
    group: "mixed",
    alg: "l' U' l L' U' L U l' U l",
    facelets: "UFFUUUBLLBRURRRRRRRUUFFFFFFDDDDDDDDDRBULLLLLLLUFBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL16",
    number: 16,
    name: "Anti-Squeegee",
    group: "mixed",
    alg: "r U r' R U R' U' r U' r'",
    facelets: "FFUUUURRBUBLRRRRRRUULFFFFFFDDDDDDDDDULBLLLLLLFURBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL17",
    number: 17,
    name: "Slash",
    group: "mixed",
    alg: "R U R' U R' F R F' U2 R' F R F'",
    facelets: "UBFFULFRULURRRRRRRLUBFFFFFFDDDDDDDDDBUULLLLLLUURBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL18",
    number: 18,
    name: "Crown",
    group: "mixed",
    alg: "R U2 R2 F R F' U2 M' U R U' r'",
    facelets: "RLUBUFRRUFUBRRRRRRFULFFFFFFDDDDDDDDDUUULLLLLLLUBBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL19",
    number: 19,
    name: "Bunny",
    group: "mixed",
    alg: "S' R U R' S U' R' F R F'",
    facelets: "FFURULRBURUBRRRRRRUUFFFFFFFDDDDDDDDDLUBLLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL20",
    number: 20,
    name: "Checkers",
    group: "edges-only",
    alg: "r' R U R U R' U' r R' M' U R U' r'",
    facelets: "ULUFUBURUFUFRRRRRRLULFFFFFFDDDDDDDDDBUBLLLLLLRURBBBBBB",
    cornerTwist: [],
    edgeFlip: ["UR", "UF", "UL", "UB"],
  },
  {
    id: "OLL21",
    number: 21,
    name: "H",
    group: "corners-only",
    alg: "R U R' U R U' R' U R U2 R'",
    facelets: "BUBUUUFUFULURRRRRRLFRFFFFFFDDDDDDDDDUBULLLLLLRRLBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL22",
    number: 22,
    name: "Pi",
    group: "corners-only",
    alg: "R U2 R2 U' R2 U' R2 U2 R",
    facelets: "FULUUUBULBRFRRRRRRRBUFFFFFFDDDDDDDDDUFULLLLLLULRBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL23",
    number: 23,
    name: "Headlights",
    group: "corners-only",
    alg: "R2 D' R U2 R' D R U2 R",
    facelets: "RUBUUUUUUBRLRRRRRRFFRFFFFFFDDDDDDDDDFLLLLLLLLUBUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL24",
    number: 24,
    name: "T",
    group: "corners-only",
    alg: "r U R' U' r' F R F'",
    facelets: "FUUUUURUURRBRRRRRRUFFFFFFFFDDDDDDDDDLLBLLLLLLLBUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL25",
    number: 25,
    name: "Bowtie",
    group: "corners-only",
    alg: "F R' F' r U R U' r'",
    facelets: "UUFUUUBUURRURRRRRRUFFFFFFFFDDDDDDDDDBLLLLLLLLLBRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL26",
    number: 26,
    name: "Antisune",
    group: "corners-only",
    alg: "R' U' R U' R' U2 R",
    facelets: "UULUUURUBUFFRRRRRRULLFFFFFFDDDDDDDDDRRBLLLLLLUBFBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL27",
    number: 27,
    name: "Sune",
    group: "corners-only",
    alg: "R U R' U R U2 R'",
    facelets: "RUFUUUUULBBURRRRRRBFUFFFFFFDDDDDDDDDFRRLLLLLLLLUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: [],
  },
  {
    id: "OLL28",
    number: 28,
    name: "Stealth",
    group: "edges-only",
    alg: "r U R' U' r' R U R U' R'",
    facelets: "UUUUUFUBURURRRRRRRFUFFFFFFFDDDDDDDDDLLLLLLLLLBRBBBBBBB",
    cornerTwist: [],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL29",
    number: 29,
    name: "Spotted Chameleon",
    group: "mixed",
    alg: "R U R' U' R U' R' F' U' F R U R'",
    facelets: "RUUUUFRRUFUBRRRRRRUULFFFFFFDDDDDDDDDFLBLLLLLLLBUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL30",
    number: 30,
    name: "Anti-Spotted Chameleon",
    group: "mixed",
    alg: "F U R U2 R' U' R U2 R' U' F'",
    facelets: "FUFUUFULUBUURRRRRRLURFFFFFFDDDDDDDDDUBBLLLLLLLRRBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL31",
    number: 31,
    name: "Couch",
    group: "mixed",
    alg: "R' U' F U R U' R' F' R",
    facelets: "BUUBUULFURRBRRRRRRUUFFFFFFFDDDDDDDDDRUFLLLLLLLLUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL32",
    number: 32,
    name: "Anti-Couch",
    group: "mixed",
    alg: "S R U R' U' R' F R f'",
    facelets: "FFUBUURUURRBRRRRRRULFFFFFFFDDDDDDDDDLUBLLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL33",
    number: 33,
    name: "Tying Shoelaces",
    group: "mixed",
    alg: "R U R' U' R' F R F'",
    facelets: "FFUUUURRURBBRRRRRRUUFFFFFFFDDDDDDDDDLLBLLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL34",
    number: 34,
    name: "C and T",
    group: "mixed",
    alg: "R U R2 U' R' F R U R U' F'",
    facelets: "RFFUUUURURBURRRRRRLUFFFFFFFDDDDDDDDDULBLLLLLLLUBBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL35",
    number: 35,
    name: "Fish Salad",
    group: "mixed",
    alg: "R U2 R2 F R F' R U2 R'",
    facelets: "URRBUUBUUBLURRRRRRUFRFFFFFFDDDDDDDDDFULLLLLLLFULBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL36",
    number: 36,
    name: "Wario",
    group: "mixed",
    alg: "L' U' L U' L' U L U L F' L' F",
    facelets: "UULFUURLUBBFRRRRRRFURFFFFFFDDDDDDDDDLUULLLLLLURBBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL37",
    number: 37,
    name: "Mounted Fish",
    group: "mixed",
    alg: "F R' F' R U R U' R'",
    facelets: "UUFUUFBBURUURRRRRRUUFFFFFFFDDDDDDDDDBLLLLLLLLLRRBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL38",
    number: 38,
    name: "Mario",
    group: "mixed",
    alg: "R U R' U R U' R' U' R' F R F'",
    facelets: "RUUUUFURLUURRRRRRRLUFFFFFFFDDDDDDDDDFBBLLLLLLBLUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL39",
    number: 39,
    name: "Fung",
    group: "mixed",
    alg: "L F' L' U' L U F U' L'",
    facelets: "BRUUUUUFFUBBRRRRRRFURFFFFFFDDDDDDDDDRLLLLLLLLLUUBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL40",
    number: 40,
    name: "Anti-Fung",
    group: "mixed",
    alg: "R' F R U R' U' F' U R",
    facelets: "ULBUUUFFURRLRRRRRRLUFFFFFFFDDDDDDDDDBBULLLLLLUURBBBBBB",
    cornerTwist: [
      { pos: "UFL", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL41",
    number: 41,
    name: "Awkward Fish",
    group: "mixed",
    alg: "R U R' U R U2 R' F R U R' U' F'",
    facelets: "FUFUUFURUBURRRRRRRLURFFFFFFDDDDDDDDDLBBLLLLLLULUBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL42",
    number: 42,
    name: "Lefty Awkward Fish",
    group: "mixed",
    alg: "R' U' R U' R' U2 R F R U R' U' F'",
    facelets: "UFUUURBUBRUFRRRRRRULUFFFFFFDDDDDDDDDFBLLLLLLLRULBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL43",
    number: 43,
    name: "Anti-P",
    group: "mixed",
    alg: "R' U' F' U F R",
    facelets: "UUUUULBRBRUFRRRRRRUUUFFFFFFDDDDDDDDDFFLLLLLLLRBLBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL44",
    number: 44,
    name: "P",
    group: "mixed",
    alg: "F U R U' R' F'",
    facelets: "UULUUFUBLUUURRRRRRRUFFFFFFFDDDDDDDDDBLFLLLLLLBRRBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL45",
    number: 45,
    name: "Suit Up",
    group: "mixed",
    alg: "F R U R' U' F'",
    facelets: "RFUUUURRUFBBRRRRRRFULFFFFFFDDDDDDDDDULULLLLLLLUBBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL46",
    number: 46,
    name: "Seein' Headlights",
    group: "mixed",
    alg: "R' U' R' F R F' U R",
    facelets: "UULFULUULUUURRRRRRRRFFFFFFFDDDDDDDDDBUFLLLLLLBBRBBBBBB",
    cornerTwist: [
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 1 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL47",
    number: 47,
    name: "Anti-Breakneck",
    group: "mixed",
    alg: "R' U' R' F R F' R' F R F' U R",
    facelets: "LUBRUULLFUFURRRRRRUURFFFFFFDDDDDDDDDBUFLLLLLLRBUBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL48",
    number: 48,
    name: "Breakneck",
    group: "mixed",
    alg: "F R U R' U' R U R' U' F'",
    facelets: "BURUUFFBRFUBRRRRRRLUUFFFFFFDDDDDDDDDULULLLLLLURLBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL49",
    number: 49,
    name: "Right Back Squeezy",
    group: "mixed",
    alg: "r U' r2 U r2 U r2 U' r",
    facelets: "FULBUUBLLBRFRRRRRRRUUFFFFFFDDDDDDDDDUUULLLLLLUFRBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UB"],
  },
  {
    id: "OLL50",
    number: 50,
    name: "Right Front Squeezy",
    group: "mixed",
    alg: "r' U r2 U' r2 U' r2 U r'",
    facelets: "FLLFUUBULBRFRRRRRRRBUFFFFFFDDDDDDDDDUUULLLLLLUURBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UF"],
  },
  {
    id: "OLL51",
    number: 51,
    name: "Bottlecap",
    group: "mixed",
    alg: "F U R U' R' U R U' R' F'",
    facelets: "LFBUUULRFUBURRRRRRUURFFFFFFDDDDDDDDDBLFLLLLLLRUUBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL52",
    number: 52,
    name: "Rice Cooker",
    group: "mixed",
    alg: "R U R' U R U' B U' B' R'",
    facelets: "BULLURFULUUURRRRRRUFFFFFFFFDDDDDDDDDRURLLLLLLBBUBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 1 },
      { pos: "ULB", twist: 2 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL53",
    number: 53,
    name: "Frying Pan",
    group: "mixed",
    alg: "l' U' L U' L' U L U' L' U2 l",
    facelets: "BUBUUFFLFUUURRRRRRLURFFFFFFDDDDDDDDDURULLLLLLRBLBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UL", "UB"],
  },
  {
    id: "OLL54",
    number: 54,
    name: "Anti-Frying Pan",
    group: "mixed",
    alg: "r U R' U R U' R' U R U2 r'",
    facelets: "BUBFUUFRFULURRRRRRLURFFFFFFDDDDDDDDDUUULLLLLLRBLBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UL"],
  },
  {
    id: "OLL55",
    number: 55,
    name: "Highway",
    group: "mixed",
    alg: "R' F R U R U' R2 F' R2 U' R' U R U R'",
    facelets: "FFBUUUFRBRLLRRRRRRUUUFFFFFFDDDDDDDDDLBRLLLLLLUUUBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UR", "UL"],
  },
  {
    id: "OLL56",
    number: 56,
    name: "Streetlights",
    group: "mixed",
    alg: "r U r' U R U' R' U R U' R' r U' r'",
    facelets: "BFBUUUFRFUBURRRRRRLURFFFFFFDDDDDDDDDULULLLLLLRULBBBBBB",
    cornerTwist: [
      { pos: "UFR", twist: 1 },
      { pos: "UFL", twist: 2 },
      { pos: "ULB", twist: 1 },
      { pos: "UBR", twist: 2 },
    ],
    edgeFlip: ["UF", "UB"],
  },
  {
    id: "OLL57",
    number: 57,
    name: "Mummy",
    group: "edges-only",
    alg: "R U R' U' M' U R U' r'",
    facelets: "UFUUUUURURBRRRRRRRFUFFFFFFFDDDDDDDDDLLLLLLLLLBUBBBBBBB",
    cornerTwist: [],
    edgeFlip: ["UF", "UB"],
  },
] as const;

export const ALL_OLL_CASE_IDS: readonly OllCaseId[] = OLL_CASES.map((c) => c.id);

export function getOllCase(id: OllCaseId): OllCase {
  const found = OLL_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown OLL case id: ${id}`);
  return found;
}

export function ollCasesByGroup(group: OllGroup): readonly OllCase[] {
  return OLL_CASES.filter((c) => c.group === group);
}

export const OLL_GROUPS: readonly OllGroup[] = ["corners-only", "edges-only", "mixed"];
