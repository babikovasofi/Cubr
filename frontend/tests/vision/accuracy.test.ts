import { describe, it, expect } from "vitest";
import { scoreRead, formatReport } from "../../src/vision/accuracy";
import { SOLVED, FACE_ORDER, type Facelet } from "../../src/vision/cubeState";
import { COLOR_NAMES } from "../../src/vision/colors";

describe("FACE_ORDER <-> COLOR_NAMES identity", () => {
  it("the facelet face order matches the calibration color order (URFDLB)", () => {
    // The accuracy harness assembles reads by capture order and scores against
    // URFDLB ground truth; that only aligns if these two orderings are identical.
    expect([...FACE_ORDER]).toEqual([...COLOR_NAMES]);
    expect([...FACE_ORDER]).toEqual(["U", "R", "F", "D", "L", "B"]);
  });
});

describe("scoreRead", () => {
  it("scores a perfect read 54/54 and PASSes", () => {
    const rep = scoreRead(SOLVED, SOLVED);
    expect(rep.total).toBe(54);
    expect(rep.correct).toBe(54);
    expect(rep.fraction).toBe(1);
    expect(rep.pass).toBe(true);
    // No off-diagonal confusion.
    for (const e of FACE_ORDER) {
      for (const r of FACE_ORDER) {
        expect(rep.confusion[e][r]).toBe(e === r ? 9 : 0);
      }
    }
  });

  it("counts each mismatch and records its confusion cell", () => {
    const a = SOLVED.split("");
    a[0] = "R"; // expected U, read R
    a[9] = "F"; // expected R, read F
    const read = a.join("") as Facelet;
    const rep = scoreRead(read, SOLVED);
    expect(rep.correct).toBe(52);
    expect(rep.confusion.U.R).toBe(1);
    expect(rep.confusion.R.F).toBe(1);
    expect(rep.confusion.U.U).toBe(8);
  });

  it("fails when below the pass fraction", () => {
    const a = SOLVED.split("");
    for (let i = 0; i < 10; i++) a[i] = a[i] === "R" ? "U" : "R"; // ~10 wrong
    const rep = scoreRead(a.join(""), SOLVED, 0.9);
    expect(rep.pass).toBe(false);
  });

  it("does not crash or pollute confusion on non-face characters (isFace guard)", () => {
    const a = SOLVED.split("");
    a[0] = "X"; // not a face letter
    const rep = scoreRead(a.join(""), SOLVED);
    expect(rep.correct).toBe(53); // X != U -> wrong
    // 'X' is not a face, so no confusion cell is incremented for index 0.
    let off = 0;
    for (const e of FACE_ORDER) for (const r of FACE_ORDER) if (e !== r) off += rep.confusion[e][r];
    expect(off).toBe(0);
    expect(rep.confusion.U.U).toBe(8); // the other 8 U stickers still counted
  });
});

describe("formatReport", () => {
  it("renders a PASS line and the confusion header", () => {
    const out = formatReport(scoreRead(SOLVED, SOLVED));
    expect(out).toContain("PASS");
    expect(out).toContain("Confusion");
  });

  it("lists mismatches when present", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const out = formatReport(scoreRead(a.join(""), SOLVED));
    expect(out).toContain("Mismatches");
    expect(out).toContain("read R, expected U");
  });
});
