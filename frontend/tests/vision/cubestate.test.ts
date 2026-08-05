import { describe, it, expect, beforeAll } from "vitest";
import Cube from "cubejs";
import {
  SOLVED,
  scrambleToFacelets,
  validateFacelets,
  diffFacelets,
  facesMatch,
  FACE_ORDER,
  randomStateFacelets,
} from "../../src/vision/cubeState";
import {
  rotateGrid,
  normalizeByRotation,
  resolveRotations,
  assignFacesByCenter,
} from "../../src/vision/cubeGrid";
import {
  applyLightGain,
  calibrate,
  deltaE,
  rgb2lab,
  type ColorName,
} from "../../src/vision/colors";

describe("URFDLB facelet mapping", () => {
  it("solved cube round-trips through cubejs", () => {
    const c = Cube.fromString(SOLVED);
    expect(c.asString()).toBe(SOLVED);
    expect(validateFacelets(SOLVED).ok).toBe(true);
  });

  it("SOLVED has centers U R F D L B at 4,13,22,31,40,49", () => {
    const centers = [4, 13, 22, 31, 40, 49];
    centers.forEach((idx, k) => expect(SOLVED[idx]).toBe(FACE_ORDER[k]));
  });

  // HIGH#1: INDEPENDENT proof of the URFDLB index mapping. We hand-build the
  // expected 54-char string for a single "U" turn from the documented capture
  // protocol and assert scrambleToFacelets("U") equals that LITERAL — NOT a
  // round-trip of cubejs against itself.
  //
  // Derivation (U = clockwise turn of the top layer, viewed from above):
  //   * U and D faces are untouched (U stays all-U, D stays all-D).
  //   * A U turn cycles the top row of the four side faces F->L->B->R, i.e. the
  //     color that LANDS on a side face's top row comes from the next face:
  //       R top row <- B's old top (BBB)
  //       F top row <- R's old top (RRR)
  //       L top row <- F's old top (FFF)
  //       B top row <- L's old top (LLL)
  //   Faces in URFDLB order, row-major (top row = first 3 chars of each face):
  //       U = UUUUUUUUU        (unchanged)
  //       R = BBB RRRRRR       (top row replaced by B)
  //       F = RRR FFFFFF       (top row replaced by R)
  //       D = DDDDDDDDD        (unchanged)
  //       L = FFF LLLLLL       (top row replaced by F)
  //       B = LLL BBBBBB       (top row replaced by L)
  it("scrambleToFacelets('U') equals the hand-derived URFDLB literal", () => {
    const HAND_BUILT_U =
      "UUUUUUUUU" + "BBBRRRRRR" + "RRRFFFFFF" + "DDDDDDDDD" + "FFFLLLLLL" + "LLLBBBBBB";
    // 6 faces * 9 = 54 chars, built entirely by hand from the turn's geometry.
    expect(HAND_BUILT_U.length).toBe(54);
    expect(scrambleToFacelets("U")).toBe(HAND_BUILT_U);
    // Sanity: the hand-built string is itself a legal cube.
    expect(validateFacelets(HAND_BUILT_U).ok).toBe(true);
  });

  it("a known scramble stays legal and round-trips (solvability sanity)", () => {
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'"; // T-perm-ish, well known
    const expected = scrambleToFacelets(scramble);
    expect(validateFacelets(expected).ok).toBe(true);
    // Applying the inverse returns to SOLVED (confirms move engine + parse).
    const c = Cube.fromString(SOLVED);
    c.move(scramble);
    c.move(invert(scramble));
    expect(c.asString()).toBe(SOLVED);
  });

  it("expected facelets differ from solved and diff pinpoints (face,index)", () => {
    const scramble = "U";
    const expected = scrambleToFacelets(scramble);
    expect(facesMatch(expected, SOLVED)).toBe(false);
    const diffs = diffFacelets(expected, SOLVED);
    expect(diffs.length).toBeGreaterThan(0);
    // A single U turn cycles the top ring of the four side faces (not U/D).
    for (const d of diffs) {
      expect(["R", "F", "L", "B"]).toContain(d.face);
    }
  });

  it("validation rejects an illegal string (wrong color count)", () => {
    const bad = "U".repeat(54); // 54 U's — impossible cube
    const v = validateFacelets(bad);
    expect(v.ok).toBe(false);
  });

  it("validation rejects a swapped-center string", () => {
    // Take solved, swap the R and F centers -> illegal.
    const arr = SOLVED.split("");
    [arr[13], arr[22]] = [arr[22], arr[13]];
    const v = validateFacelets(arr.join(""));
    expect(v.ok).toBe(false);
  });
});

describe("random state", () => {
  beforeAll(() => {
    Cube.initSolver();
  });

  it("randomStateFacelets yields a legal, solvable cube", () => {
    const { scramble, facelets } = randomStateFacelets();
    expect(validateFacelets(facelets).ok).toBe(true);
    // Applying the reported solve sequence returns to solved.
    const c = Cube.fromString(facelets);
    c.move(scramble);
    expect(c.asString()).toBe(SOLVED);
  });
});

describe("grid rotation normalization", () => {
  it("rotateGrid by 4 quarter-turns is identity", () => {
    const g = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(rotateGrid(g, 4)).toEqual(g);
    expect(rotateGrid(g, 0)).toEqual(g);
  });

  it("rotateGrid CW once puts index 6 (bottom-left) at top-left (index 0)", () => {
    const g = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    // CW: (r,c)->(c,2-r). bottom-left (2,0)=6 -> (0,0)=index0.
    const r = rotateGrid(g, 1);
    expect(r[0]).toBe(6);
    expect(r[4]).toBe(4); // center invariant
  });

  it("normalizeByRotation keeps center (cell 4) invariant under any k", () => {
    const g = ["a", "b", "c", "d", "X", "e", "f", "g", "h"];
    for (let k = 0; k < 4; k++) {
      expect(normalizeByRotation(g, k)[4]).toBe("X");
    }
  });
});

describe("auto-orientation (plan #6)", () => {
  // Slice a 54-char URFDLB string into 6 face grids of 9 face-letters each.
  function toFaceGrids(s: string): string[][] {
    const grids: string[][] = [];
    for (let f = 0; f < 6; f++) grids.push(s.slice(f * 9, f * 9 + 9).split(""));
    return grids;
  }

  it("resolveRotations recovers the legal string from wrongly-rotated captures", () => {
    // A known scrambled cube (ground truth).
    const scramble = "R U R' U' F2 D L' B";
    const truth = scrambleToFacelets(scramble);
    expect(validateFacelets(truth).ok).toBe(true);

    const trueGrids = toFaceGrids(truth) as any[][];
    // Deliberately rotate each captured face by a WRONG amount.
    const wrongK = [1, 2, 3, 1, 2, 3]; // per-capture CW quarter-turns
    const captured = trueGrids.map((g, i) => rotateGrid(g, wrongK[i]));
    // Captures are in URFDLB face order here (center assignment done separately).
    const faceOf = [...FACE_ORDER];

    const res = resolveRotations(captured as any, faceOf as any);
    expect(res.ok).toBe(true);
    expect(res.facelets).toBe(truth);
    // The recovered rotation must undo the wrong one: k_recover = (4 - wrongK)%4.
    res.rotations!.forEach((k, i) => expect(k).toBe((4 - wrongK[i]) % 4));
  });

  it("resolveRotations FAILS LOUD when no combo is legal (garbage read)", () => {
    // A face string that is not a legal cube under any rotation: 54 of one color
    // impossible, but with valid centers so it passes the count-agnostic path.
    // Build 6 faces where every non-center sticker is the same wrong color.
    const grids: string[][] = FACE_ORDER.map((f) => {
      const g = new Array(9).fill("U");
      g[4] = f; // correct center only
      return g;
    });
    const res = resolveRotations(grids as any, [...FACE_ORDER] as any);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/legal|ambiguous|re-capture/);
  });

  it("assignFacesByCenter names each face by its center color and detects dupes", () => {
    // Build 6 synthetic solved refs, one per face, with well-separated colors.
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [255, 255, 255], // white
      R: [200, 0, 0], // red
      F: [0, 160, 0], // green
      D: [230, 230, 0], // yellow
      L: [255, 140, 0], // orange
      B: [0, 0, 200], // blue
    };
    const refs = calibrate(refRgb);
    // Each captured face is a solid patch of its color (center = that color).
    const gridsLab = FACE_ORDER.map((f) => new Array(9).fill(rgb2lab(refRgb[f as ColorName])));
    const a = assignFacesByCenter(gridsLab as any, refs);
    expect(a.ok).toBe(true);
    expect(a.faces).toEqual([...FACE_ORDER]);

    // Duplicate a face (two captures both centered on white) -> FAIL LOUD.
    const dupLab = gridsLab.map((g) => g.slice());
    dupLab[1] = new Array(9).fill(rgb2lab(refRgb.U)); // 2nd capture also white
    const bad = assignFacesByCenter(dupLab as any, refs);
    expect(bad.ok).toBe(false);
  });

  it("assignFacesByCenter saves a read where argmin would collide on red/orange", () => {
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [235, 235, 235],
      R: [190, 40, 40], // красный
      F: [40, 160, 70],
      D: [235, 210, 50],
      L: [225, 110, 35], // оранжевый
      B: [35, 70, 180],
    };
    const refs = calibrate(refRgb);
    // Красный центр под тёплым светом «порыжел» и по одиночному argmin ближе к
    // оранжевому эталону, чем к своему. Сам оранжевый центр при этом чистый.
    const warmRed: [number, number, number] = [215, 85, 40]; // ΔE: до R 13.8, до L 9.0
    const centers: Record<ColorName, [number, number, number]> = {
      ...refRgb,
      R: warmRed,
    };
    const gridsLab = FACE_ORDER.map((f) => new Array(9).fill(rgb2lab(centers[f as ColorName])));

    // Одиночный argmin отдал бы оранжевый дважды: и порыжевшему красному, и
    // настоящему оранжевому.
    const nearest = (lab: any) => {
      let best = "U";
      let bestD = Infinity;
      for (const n of Object.keys(refRgb) as ColorName[]) {
        const d = deltaE(lab, (refs as any)[n]);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };
    const argmin = gridsLab.map((g) => nearest(g[4]));
    expect(argmin.filter((f) => f === "L").length).toBe(2);

    // Раскладка целиком выдаёт каждой съёмке её собственный цвет.
    const a = assignFacesByCenter(gridsLab as any, refs);
    expect(a.ok).toBe(true);
    expect(a.faces).toEqual([...FACE_ORDER]);
  });

  it("assignFacesByCenter refuses when a capture centre is nowhere near its colour", () => {
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [255, 255, 255],
      R: [200, 0, 0],
      F: [0, 160, 0],
      D: [230, 230, 0],
      L: [255, 140, 0],
      B: [0, 0, 200],
    };
    const refs = calibrate(refRgb);
    const gridsLab = FACE_ORDER.map((f) => new Array(9).fill(rgb2lab(refRgb[f as ColorName])));
    // Вместо синей грани сняли столешницу: раскладке всё равно останется только
    // слот B, и без замка она молча объявила бы стол синей гранью.
    gridsLab[5] = new Array(9).fill(rgb2lab([150, 130, 110]));
    const res = assignFacesByCenter(gridsLab as any, refs);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/centre is/);
  });

  it("assignFacesByCenter keeps a read where the light moved for ALL six captures", () => {
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [235, 235, 235],
      R: [190, 40, 40],
      F: [40, 160, 70],
      D: [235, 210, 50],
      L: [225, 110, 35],
      B: [35, 70, 180],
    };
    const refs = calibrate(refRgb);
    // Калибровались при одном свете, читаем при заметно более тусклом: канальный
    // сдвиг двигает ВСЕ шесть центров разом, но цвета остаются различимы, и
    // чтение имеет смысл. Замок обязан пропустить — он про подменённую грань, а
    // не про свет.
    const dimmer: [number, number, number] = [0.35, 0.5, 0.9];
    const gridsLab = FACE_ORDER.map((f) =>
      new Array(9).fill(rgb2lab(applyLightGain(refRgb[f as ColorName], dimmer))),
    );
    const res = assignFacesByCenter(gridsLab as any, refs);
    expect(res.ok).toBe(true);
    expect(res.faces).toEqual([...FACE_ORDER]);
    // Сдвиг ощутимый: центры ушли далеко от эталонов, и всё равно все шесть
    // опознаны — потому что ушли ВМЕСТЕ.
    expect(res.medianDE).toBeGreaterThan(15);
  });

  it("assignFacesByCenter still refuses the ONE capture that breaks ranks", () => {
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [235, 235, 235],
      R: [190, 40, 40],
      F: [40, 160, 70],
      D: [235, 210, 50],
      L: [225, 110, 35],
      B: [35, 70, 180],
    };
    const refs = calibrate(refRgb);
    const dimmer: [number, number, number] = [0.72, 0.78, 0.95];
    const gridsLab = FACE_ORDER.map((f) =>
      new Array(9).fill(rgb2lab(applyLightGain(refRgb[f as ColorName], dimmer))),
    );
    // Та же уехавшая сессия, но одна съёмка — столешница.
    gridsLab[2] = new Array(9).fill(rgb2lab([150, 130, 110]));
    const res = assignFacesByCenter(gridsLab as any, refs);
    expect(res.ok).toBe(false);
    expect(res.offender?.capture).toBe(2);
    expect(res.reason).toMatch(/not a cube face/);
  });

  it("assignFacesByCenter refuses a capture count other than six", () => {
    const refRgb: Record<ColorName, [number, number, number]> = {
      U: [255, 255, 255],
      R: [200, 0, 0],
      F: [0, 160, 0],
      D: [230, 230, 0],
      L: [255, 140, 0],
      B: [0, 0, 200],
    };
    const refs = calibrate(refRgb);
    const gridsLab = FACE_ORDER.slice(0, 5).map((f) =>
      new Array(9).fill(rgb2lab(refRgb[f as ColorName])),
    );
    const res = assignFacesByCenter(gridsLab as any, refs);
    expect(res.ok).toBe(false);
    expect(res.faces).toHaveLength(5);
  });
});

describe("validateFacelets solvability / parity (re-review HIGH)", () => {
  // Count-valid (9 each), centers correct, but physically ILLEGAL: a single
  // corner twisted. The OLD gate (Cube.fromString(s).asString() === s) round-
  // trips and ACCEPTS this; the real solvability check must REJECT it.
  const TWIST_ILLEGAL = "UUUUUUUUFURRRRRRRRFFRFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

  it("rejects a count/center-valid but parity-illegal cube (single corner twist)", () => {
    // Prove ONLY parity can catch it: counts and centers are valid.
    const counts: Record<string, number> = {};
    for (const ch of TWIST_ILLEGAL) counts[ch] = (counts[ch] ?? 0) + 1;
    expect(Object.values(counts).every((n) => n === 9)).toBe(true);
    expect([4, 13, 22, 31, 40, 49].map((i) => TWIST_ILLEGAL[i]).join("")).toBe("URFDLB");
    // cubejs round-trips it -> the old asString() gate was insufficient.
    expect(Cube.fromString(TWIST_ILLEGAL).asString()).toBe(TWIST_ILLEGAL);
    // Real solvability check rejects it.
    expect(validateFacelets(TWIST_ILLEGAL).ok).toBe(false);
  });

  it("accepts a genuinely legal scrambled cube", () => {
    expect(validateFacelets(scrambleToFacelets("R U R' U' F2 D L' B")).ok).toBe(true);
  });
});

// Minimal move inverter for the round-trip check.
function invert(seq: string): string {
  return seq
    .trim()
    .split(/\s+/)
    .reverse()
    .map((m) => {
      if (m.endsWith("'")) return m.slice(0, -1);
      if (m.endsWith("2")) return m;
      return m + "'";
    })
    .join(" ");
}
