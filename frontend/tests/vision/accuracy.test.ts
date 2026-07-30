import { describe, it, expect } from "vitest";
import { scoreRead, formatReport, type CellDiag } from "../../src/vision/accuracy";
import { SOLVED, FACE_ORDER, type Facelet } from "../../src/vision/cubeState";
import { COLOR_NAMES } from "../../src/vision/colors";
import { config } from "../../src/vision/config";

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

  it("без диагностики отчёт остаётся прежним — ни kept, ни отрыва", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const out = formatReport(scoreRead(a.join(""), SOLVED));
    expect(out).not.toContain("kept");
    expect(out).not.toContain("Почему ошиблись");
  });

  // Три болезни дают одинаковую строку «прочиталось не то», а лечатся по-разному.
  // Диагностика обязана их различать: пересвет — по kept, слипшиеся эталоны — по
  // отрыву от второго кандидата.
  it("к промаху приписывает kept и отрыв, а выбитую ячейку помечает", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    a[1] = "B";
    const diags: CellDiag[] = Array.from({ length: 54 }, () => ({
      rgb: [200, 200, 200] as [number, number, number],
      kept: 0.9,
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: 40,
    }));
    diags[0] = { rgb: [180, 60, 60], kept: 0.05, best: "R", bestDE: 8, second: "L", secondDE: 26.5 };
    diags[1] = { rgb: [40, 90, 190], kept: 0.8, best: "B", bestDE: 11, second: "U", secondDE: 12.5 };

    const out = formatReport(scoreRead(a.join(""), SOLVED), diags);
    expect(out).toContain("kept 5% (ВЫБИТА), ΔE R 8.0 / L 26.5, отрыв 18.5");
    expect(out).toContain("kept 80%, ΔE B 11.0 / U 12.5, отрыв 1.5");
    // Ячейка с kept 80% не выбита — метка только у первой.
    expect(out.match(/ВЫБИТА/g)).toHaveLength(1);
  });

  it("сводка считает выбитые ячейки и ячейки без отрыва по всем 54", () => {
    const diags: CellDiag[] = Array.from({ length: 54 }, (_, i) => ({
      rgb: [200, 200, 200] as [number, number, number],
      kept: i < 4 ? 0.1 : 0.9, // 4 выбиты пересветом
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: i < 7 ? 3.5 : 40, // 7 без отрыва (config.STICKER_MARGIN_MIN)
    }));
    const out = formatReport(scoreRead(SOLVED, SOLVED), diags);
    expect(out).toContain(
      `выбитых пересветом (kept < ${(config.CELL_MIN_KEPT_FRAC * 100).toFixed(0)}%): 4`,
    );
    expect(out).toContain(`без отрыва от второго кандидата (< ${config.STICKER_MARGIN_MIN}): 7`);
  });

  // Живой отказ: ячейка ровная (kept 100%), а до БЛИЖАЙШЕГО эталона 33 — цвет не
  // принадлежит кубику вообще, argmin выбирает наименее далёкий и врёт. Такую
  // ячейку нельзя путать со «спутал похожие цвета»: лечится она не порогами.
  it("помечает ячейку, не похожую ни на один цвет кубика, и считает их в сводке", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const diags: CellDiag[] = Array.from({ length: 54 }, (_, i) => ({
      rgb: i === 0 ? ([150, 110, 80] as [number, number, number]) : [235, 238, 236],
      kept: 1,
      best: i === 0 ? "R" : "U",
      bestDE: i === 0 ? config.STICKER_MAX_DELTA_E + 1 : 3,
      second: i === 0 ? "L" : "D",
      secondDE: i === 0 ? config.STICKER_MAX_DELTA_E + 4 : 40,
    }));

    const out = formatReport(scoreRead(a.join(""), SOLVED), diags);
    expect(out).toContain("RGB(150,110,80)");
    expect(out).toContain("(НЕ ЦВЕТ КУБИКА)");
    expect(out).toContain(
      `не похожих ни на один цвет кубика (ΔE > ${config.STICKER_MAX_DELTA_E}): 1`,
    );
    // Медиана берётся по всем 54, поэтому одна далёкая ячейка её не сдвигает.
    expect(out).toContain("медианный ΔE до ближайшего эталона: 3.0");
  });
});
