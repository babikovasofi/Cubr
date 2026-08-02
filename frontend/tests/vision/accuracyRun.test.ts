import { describe, it, expect } from "vitest";
import {
  assembleRawRead,
  looksSolvedRead,
  appendRead,
  appendDrop,
  undoRead,
  conditionVerdict,
  condKeyString,
  gatePass,
  hotspots,
  wilsonLowerBound,
  MIN_READS,
  MAX_DROP_RATE,
  type AccuracyRun,
  type ConditionKey,
} from "../../src/vision/accuracyRun";
import { scoreRead } from "../../src/vision/accuracy";
import { SOLVED, scrambleToFacelets, type Face, type Facelet } from "../../src/vision/cubeState";

// --- helpers ---------------------------------------------------------------

function toGrids(f: Facelet): Face[][] {
  const grids: Face[][] = [];
  for (let i = 0; i < 6; i++) grids.push(f.slice(i * 9, i * 9 + 9).split("") as Face[]);
  return grids;
}

// Flip listed indices to a DIFFERENT face than the truth (deterministic error).
const OTHER: Record<string, Face> = { U: "R", R: "U", F: "D", D: "F", L: "B", B: "L" };
function corrupt(truth: Facelet, indices: number[]): Facelet {
  const a = truth.split("");
  for (const i of indices) a[i] = OTHER[a[i]];
  return a.join("");
}

const COND: ConditionKey = {
  mode: "scramble",
  light: "день",
  cube: "стикерный",
  person: "A",
  calib: "fresh",
};

describe("undoRead", () => {
  it("un-merges the exact report and books a mis-scramble drop, keeping other reads", () => {
    const run: AccuracyRun = new Map();
    const truth = scrambleToFacelets("R U R' U'");
    const good = scoreRead(truth, truth); // 54/54
    const bad = scoreRead(corrupt(truth, [0, 1, 2, 3, 4]), truth); // 49/54
    appendRead(run, COND, good);
    appendRead(run, COND, bad);
    undoRead(run, COND, bad, "mis-scramble");
    const acc = run.get(condKeyString(COND))!;
    expect(acc.nScored).toBe(1); // only the good read remains
    expect(acc.correct).toBe(good.correct);
    expect(acc.total).toBe(good.total);
    expect(acc.nDropped).toBe(1);
    expect(acc.dropReasons["mis-scramble"]).toBe(1);
  });

  it("is a no-op on an empty condition", () => {
    const run: AccuracyRun = new Map();
    const truth = scrambleToFacelets("R U");
    undoRead(run, COND, scoreRead(truth, truth));
    expect(run.get(condKeyString(COND))).toBeUndefined();
  });
});

// --- assembleRawRead -------------------------------------------------------

describe("assembleRawRead", () => {
  it("round-trips a scramble's facelets 54/54 in fixed capture order", () => {
    const truth = scrambleToFacelets("R U R' U' F2 L D2 B");
    const grids = toGrids(truth);
    const raw = assembleRawRead(grids);
    expect(raw).toHaveLength(54);
    expect(raw).toBe(truth);
    const rep = scoreRead(raw, truth);
    expect(rep.correct).toBe(54);
    expect(rep.total).toBe(54);
  });

  it("throws on malformed grid shape", () => {
    expect(() => assembleRawRead(toGrids(SOLVED).slice(0, 5))).toThrow();
    const bad = toGrids(SOLVED);
    bad[0] = bad[0].slice(0, 8);
    expect(() => assembleRawRead(bad)).toThrow();
  });
});

// --- injected errors -> exact wrong count + confusion ----------------------

describe("scoreRead over an assembled raw read", () => {
  it("K injected errors -> exactly K wrong and the right confusion cells", () => {
    const truth = scrambleToFacelets("R U R' U' F2 L D2 B");
    const idxs = [0, 9, 36];
    const read = corrupt(truth, idxs);
    const rep = scoreRead(read, truth);
    expect(rep.correct).toBe(54 - idxs.length);
    // Each flipped sticker lands in exactly its expected->read confusion cell.
    for (const i of idxs) {
      expect(rep.confusion[truth[i] as Face][read[i] as Face]).toBeGreaterThanOrEqual(1);
    }
    // Off-diagonal confusion (both faces) sums to exactly K.
    let off = 0;
    for (const e of ["U", "R", "F", "D", "L", "B"] as Face[])
      for (const r of ["U", "R", "F", "D", "L", "B"] as Face[]) if (e !== r) off += rep.confusion[e][r];
    expect(off).toBe(idxs.length);
  });

  it("routes red<->orange (R<->L) misreads into the redOrange hotspot", () => {
    const run: AccuracyRun = new Map();
    // Two R (red) stickers read as L (orange) on an otherwise-solved cube.
    const a = SOLVED.split("");
    a[9] = "L";
    a[10] = "L";
    appendRead(run, COND, scoreRead(a.join(""), SOLVED));
    const acc = run.get(condKeyString(COND))!;
    const hs = hotspots(acc);
    expect(hs.redOrange.aToB).toBe(2); // R->L
    expect(hs.redOrange.bToA).toBe(0);
    expect(hs.redOrange.total).toBe(2);
    expect(hs.redOrange.n).toBe(18); // all R(9) + L(9) expected stickers
  });
});

// --- per-condition merge ---------------------------------------------------

describe("appendRead / appendDrop accumulation", () => {
  it("merges reads within a condition and keeps conditions separate", () => {
    const run: AccuracyRun = new Map();
    appendRead(run, COND, scoreRead(SOLVED, SOLVED)); // 54/54
    appendRead(run, COND, scoreRead(corrupt(SOLVED, [0]), SOLVED)); // 53/54
    const acc = run.get(condKeyString(COND))!;
    expect(acc.nScored).toBe(2);
    expect(acc.total).toBe(108);
    expect(acc.correct).toBe(107);

    const other: ConditionKey = { ...COND, light: "LED" };
    appendRead(run, other, scoreRead(SOLVED, SOLVED));
    expect(run.size).toBe(2);
    expect(run.get(condKeyString(other))!.nScored).toBe(1);
  });

  // Санити (собранный кубик) и известный скрамбл меряют разное: на однотонной
  // грани нет соседства красного с оранжевым, и промах сетки на наклейку того же
  // цвета не виден. Пока режим не входил в ключ, идеальные санити-чтения
  // подмешивались к скрамблу и вытягивали среднее — гейт закрывался бы на
  // задаче, которой в продукте нет.
  it("держит санити и скрамбл разными условиями", () => {
    const run: AccuracyRun = new Map();
    const solved: ConditionKey = { ...COND, mode: "solved" };
    const scrambleCond: ConditionKey = { ...COND, mode: "scramble" };

    appendRead(run, solved, scoreRead(SOLVED, SOLVED)); // 54/54
    appendRead(run, scrambleCond, scoreRead(corrupt(SOLVED, [0, 1, 2]), SOLVED)); // 51/54

    expect(run.size).toBe(2);
    expect(run.get(condKeyString(solved))!.correct).toBe(54);
    expect(run.get(condKeyString(scrambleCond))!.correct).toBe(51);
    // Худшее условие — скрамбл; min-по-условиям обязан смотреть на него.
    const gate = gatePass(run, 0.9);
    expect(gate.min?.key.mode).toBe("scramble");
  });

  it("counts drops in the denominator with a reason histogram", () => {
    const run: AccuracyRun = new Map();
    appendRead(run, COND, scoreRead(SOLVED, SOLVED));
    appendDrop(run, COND, "unreadable");
    appendDrop(run, COND, "drift");
    const acc = run.get(condKeyString(COND))!;
    expect(acc.nDropped).toBe(2);
    expect(acc.dropReasons.unreadable).toBe(1);
    expect(acc.dropReasons.drift).toBe(1);
    const v = conditionVerdict(acc);
    expect(v.dropRate).toBeCloseTo(2 / 3, 6);
  });
});

// --- Wilson gate -----------------------------------------------------------

describe("wilsonLowerBound + conditionVerdict", () => {
  it("Wilson-LB is below the point estimate and 0 at n=0", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    const lb = wilsonLowerBound(972, 1080); // point estimate exactly 0.90
    expect(lb).toBeLessThan(0.9);
  });

  it("point-estimate 90% FAILS the gate (Wilson-LB < 0.90)", () => {
    const run: AccuracyRun = new Map();
    // 20 reads, each with exactly ~5.4 wrong is impossible; use 108 wrong total
    // across 20 reads: 8 reads of 6 wrong + 12 reads of 5 wrong = 48+60=108.
    for (let k = 0; k < 20; k++) {
      const wrong = k < 8 ? 6 : 5;
      const idx = Array.from({ length: wrong }, (_, i) => i);
      appendRead(run, COND, scoreRead(corrupt(SOLVED, idx), SOLVED));
    }
    const acc = run.get(condKeyString(COND))!;
    expect(acc.correct).toBe(1080 - 108);
    expect(acc.correct / acc.total).toBeCloseTo(0.9, 3);
    const v = conditionVerdict(acc);
    expect(v.enoughReads).toBe(true);
    expect(v.pass).toBe(false); // Wilson-LB < 0.90
  });

  it("a comfortably-high condition PASSES", () => {
    const run: AccuracyRun = new Map();
    for (let k = 0; k < 20; k++) {
      appendRead(run, COND, scoreRead(corrupt(SOLVED, [0, 1]), SOLVED)); // 52/54
    }
    const v = conditionVerdict(run.get(condKeyString(COND))!);
    expect(v.wilsonLower).toBeGreaterThanOrEqual(0.9);
    expect(v.pass).toBe(true);
  });
});

// --- MIN_READS + drop-rate + min-over-conditions ---------------------------

describe("gatePass", () => {
  function fillPassing(run: AccuracyRun, key: ConditionKey, n = MIN_READS): void {
    for (let k = 0; k < n; k++) appendRead(run, key, scoreRead(corrupt(SOLVED, [0, 1]), SOLVED));
  }

  it("requires >= MIN_READS before a condition can pass", () => {
    const run: AccuracyRun = new Map();
    fillPassing(run, COND, MIN_READS - 1);
    const v = conditionVerdict(run.get(condKeyString(COND))!);
    expect(v.enoughReads).toBe(false);
    expect(v.pass).toBe(false);
    expect(gatePass(run).pass).toBe(false);
  });

  it("fails a condition whose drop-rate exceeds the threshold despite perfect reads", () => {
    const run: AccuracyRun = new Map();
    for (let k = 0; k < MIN_READS; k++) appendRead(run, COND, scoreRead(SOLVED, SOLVED));
    // Push drop-rate above MAX_DROP_RATE (0.15): 20 scored + 5 dropped = 0.2.
    for (let k = 0; k < 5; k++) appendDrop(run, COND, "unreadable");
    const v = conditionVerdict(run.get(condKeyString(COND))!);
    expect(v.dropRate).toBeGreaterThan(MAX_DROP_RATE);
    expect(v.pass).toBe(false);
  });

  it("gate = MIN over conditions: one failing condition fails the whole gate", () => {
    const run: AccuracyRun = new Map();
    const good: ConditionKey = { ...COND, light: "день" };
    const bad: ConditionKey = { ...COND, light: "LED" };
    fillPassing(run, good);
    for (let k = 0; k < MIN_READS; k++) {
      const idx = Array.from({ length: 8 }, (_, i) => i); // 46/54 ~ 85%
      appendRead(run, bad, scoreRead(corrupt(SOLVED, idx), SOLVED));
    }
    const gate = gatePass(run);
    expect(gate.conditions).toHaveLength(2);
    expect(gate.pass).toBe(false);
    expect(gate.min!.key.light).toBe("LED"); // worst condition is the LED one
  });

  it("passes only when EVERY condition passes", () => {
    const run: AccuracyRun = new Map();
    fillPassing(run, { ...COND, light: "день" });
    fillPassing(run, { ...COND, light: "LED" });
    const gate = gatePass(run);
    expect(gate.conditions).toHaveLength(2);
    expect(gate.pass).toBe(true);
  });

  it("empty run does not pass", () => {
    expect(gatePass(new Map()).pass).toBe(false);
  });
});

// Живой отказ 2026-08-03: тестировщик снял кубик, не собрав на нём скрамбл.
// Зрение отработало верно — каждая грань прочитана своим цветом, — а совпало с
// эталоном 15/54, то есть на уровне случайного. Записать это в точность значило
// бы приписать зрению чужую ошибку.
describe("looksSolvedRead", () => {
  const uniform = (c: string): Face[] => Array.from({ length: 9 }, () => c as Face);

  it("шесть одноцветных граней — кубик собран", () => {
    expect(looksSolvedRead(["U", "R", "F", "D", "L", "B"].map(uniform))).toBe(true);
  });

  it("одной пёстрой грани хватает, чтобы чтение считалось скрамблированным", () => {
    const grids = ["U", "R", "F", "D", "L", "B"].map(uniform);
    grids[2][4] = "B" as Face;
    expect(looksSolvedRead(grids)).toBe(false);
  });

  it("неполный набор граней не выдаётся за собранный кубик", () => {
    expect(looksSolvedRead(["U", "R", "F"].map(uniform))).toBe(false);
  });
});
