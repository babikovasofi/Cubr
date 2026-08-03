import { describe, expect, it } from "vitest";

import { hungarian, minCostQuotaAssign } from "../../src/vision/assignment";
import { config } from "../../src/vision/config";
import {
  COLOR_NAMES,
  assignQuota,
  cellWeight,
  deltaE,
  rgb2lab,
  type ColorName,
  type Lab,
  type RGB,
  type Refs,
} from "../../src/vision/colors";

// Жадная раздача — ровно та, что стояла в assignQuota до венгерского алгоритма.
// Живёт в тестах как ЭТАЛОН ХУДШЕГО: доказываем, что оптимум её не проигрывает.
function greedyQuota(costs: number[][], quotas: number[]): (number | null)[] {
  const out = new Array<number | null>(costs.length).fill(null);
  const left = [...quotas];
  const pairs: { i: number; g: number; d: number }[] = [];
  for (let i = 0; i < costs.length; i++) {
    for (let g = 0; g < quotas.length; g++) pairs.push({ i, g, d: costs[i][g] });
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const { i, g } of pairs) {
    if (out[i] !== null || left[g] <= 0) continue;
    out[i] = g;
    left[g] -= 1;
  }
  return out;
}

function totalCost(costs: number[][], assign: (number | null)[]): number {
  let sum = 0;
  for (let i = 0; i < assign.length; i++) {
    const g = assign[i];
    if (g !== null) sum += costs[i][g];
  }
  return sum;
}

describe("hungarian", () => {
  it("finds the minimum-cost perfect matching, not the greedy one", () => {
    // Жадный схватил бы (0,0)=1 и остался с (1,1)=100 → 101. Оптимум = 2+3 = 5.
    const cost = [
      [1, 2],
      [3, 100],
    ];
    const rowToCol = hungarian(cost);
    expect(rowToCol).toEqual([1, 0]);
  });

  it("handles a 1x1 and an empty matrix", () => {
    expect(hungarian([[7]])).toEqual([0]);
    expect(hungarian([])).toEqual([]);
  });

  it("assigns every row to a distinct column", () => {
    const n = 12;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const cost = Array.from({ length: n }, () => Array.from({ length: n }, () => rand() * 50));
    const rowToCol = hungarian(cost);
    expect(new Set(rowToCol).size).toBe(n);
    expect(rowToCol.every((c) => c >= 0 && c < n)).toBe(true);
  });
});

describe("minCostQuotaAssign", () => {
  it("beats greedy on the red/orange trade the quota exists for", () => {
    // Один свободный слот красного (группа 0) и один оранжевого (группа 1).
    // X безразличен между ними, Y без красного пропадает.
    const costs = [
      [5, 6], // X
      [7, 40], // Y
    ];
    const quotas = [1, 1];

    expect(greedyQuota(costs, quotas)).toEqual([0, 1]); // X→красный, Y→оранжевый = 45
    expect(minCostQuotaAssign(costs, quotas)).toEqual([1, 0]); // X→оранжевый, Y→красный = 13
  });

  it("respects quotas exactly", () => {
    const costs = Array.from({ length: 6 }, () => [1, 1, 1]);
    const got = minCostQuotaAssign(costs, [3, 2, 1]);
    const counts = [0, 0, 0];
    for (const g of got) if (g !== null) counts[g] += 1;
    expect(counts).toEqual([3, 2, 1]);
  });

  it("leaves the DEAREST items unplaced when there are fewer slots than items", () => {
    // Три претендента, два места: без места должен остаться самый дорогой.
    const costs = [[1], [2], [50]];
    const got = minCostQuotaAssign(costs, [2]);
    expect(got).toEqual([0, 0, null]);
  });

  it("places nobody when every quota is zero", () => {
    expect(minCostQuotaAssign([[1], [2]], [0])).toEqual([null, null]);
  });

  it("returns an empty result for an empty input", () => {
    expect(minCostQuotaAssign([], [9])).toEqual([]);
  });
});

describe("cellWeight", () => {
  it("trusts a clean cell fully and a blown one partially", () => {
    expect(cellWeight(1)).toBe(1);
    expect(cellWeight(config.CELL_MIN_KEPT_FRAC)).toBe(1);
    expect(cellWeight(config.CELL_MIN_KEPT_FRAC / 2)).toBeCloseTo(0.5, 5);
    // Ноль пикселей — не ноль доверия: иначе ячейка становится невидимой для
    // оптимизации и уезжает в произвольный слот.
    expect(cellWeight(0)).toBe(config.CELL_WEIGHT_MIN);
    expect(cellWeight(Number.NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Тот же вопрос на настоящей колоде: 54 наклейки, шесть эталонов, живые ΔE.
// ---------------------------------------------------------------------------

const baseRGB: Record<ColorName, RGB> = {
  U: [235, 235, 235], // белый
  R: [190, 40, 40], // красный
  F: [40, 160, 70], // зелёный
  D: [235, 210, 50], // жёлтый
  L: [225, 110, 35], // оранжевый
  B: [35, 70, 180], // синий
};

function makeRefs(): Refs {
  const refs = {} as Refs;
  for (const name of COLOR_NAMES) refs[name] = rgb2lab(baseRGB[name]);
  return refs;
}

/** Колода из 54 наклеек: cells[k] — цвет k-й наклейки грани COLOR_NAMES[faceIdx]. */
function deck(mutate: (name: ColorName, cell: number) => RGB): {
  labs: Lab[];
  centerIdx: number[];
  truth: ColorName[];
} {
  const labs: Lab[] = [];
  const truth: ColorName[] = [];
  const centerIdx: number[] = [];
  COLOR_NAMES.forEach((name, faceIdx) => {
    for (let cell = 0; cell < 9; cell++) {
      if (cell === 4) centerIdx.push(faceIdx * 9 + cell);
      labs.push(rgb2lab(cell === 4 ? baseRGB[name] : mutate(name, cell)));
      truth.push(name);
    }
  });
  return { labs, centerIdx, truth };
}

function costMatrix(
  labs: Lab[],
  refs: Refs,
  skip: Set<number>,
): { costs: number[][]; idx: number[] } {
  const idx: number[] = [];
  for (let i = 0; i < labs.length; i++) if (!skip.has(i)) idx.push(i);
  return { costs: idx.map((i) => COLOR_NAMES.map((n) => deltaE(labs[i], refs[n]))), idx };
}

describe("assignQuota on a real 54-sticker deck", () => {
  it("never costs more than the greedy pass it replaced", () => {
    const refs = makeRefs();
    let seed = 20260803;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };

    for (let run = 0; run < 40; run++) {
      // Шум, который специально размывает красный в оранжевый и обратно —
      // единственная пара, на которой квоты вообще что-то решают.
      const { labs, centerIdx } = deck((name) => {
        const base = baseRGB[name];
        const pull = name === "R" || name === "L" ? 70 : 18;
        return [
          Math.max(0, Math.min(255, base[0] + rand() * pull)),
          Math.max(0, Math.min(255, base[1] + rand() * pull)),
          Math.max(0, Math.min(255, base[2] + rand() * pull)),
        ];
      });

      const { costs, idx } = costMatrix(labs, refs, new Set(centerIdx));
      const quotas = COLOR_NAMES.map(() => 8); // центры уже припиннованы
      const greedy = totalCost(costs, greedyQuota(costs, quotas));

      const res = assignQuota(labs, refs, centerIdx);
      const optimal = idx.reduce(
        (sum, globalIdx, row) => sum + costs[row][COLOR_NAMES.indexOf(res.assignment[globalIdx])],
        0,
      );

      expect(optimal).toBeLessThanOrEqual(greedy + 1e-9);
      expect(res.balanced).toBe(true);
    }
  });

  it("reads a whole face right where greedy misfiles two stickers", () => {
    const refs = makeRefs();
    // Оранжевая наклейка в тени утянута между оранжевым и красным, самую малость
    // ближе к красному (ΔE 10.6 против 12.1) — жадному она дешевле всех, и он
    // сажает её в последний свободный красный слот. Красная наклейка при этом
    // просто тёмная: до красного 14.6, до оранжевого 34.2. Ей после жадного
    // остаётся только оранжевый — 44.8 за две неверных наклейки. Оптимум разводит
    // их по своим местам за 26.7 и обе читает верно.
    const { labs, centerIdx, truth } = deck((name, cell) => {
      if (name === "L" && cell === 0) return [212, 74, 38];
      if (name === "R" && cell === 0) return [120, 20, 20];
      return baseRGB[name];
    });

    const { costs, idx } = costMatrix(labs, refs, new Set(centerIdx));
    const quotas = COLOR_NAMES.map(() => 8);
    const greedyAssign = greedyQuota(costs, quotas);
    const greedyNames = new Array<ColorName | null>(labs.length).fill(null);
    idx.forEach((globalIdx, row) => {
      const g = greedyAssign[row];
      greedyNames[globalIdx] = g === null ? null : COLOR_NAMES[g];
    });

    const res = assignQuota(labs, refs, centerIdx);

    // Жадный меняет две наклейки местами; оптимум обе читает верно.
    const greedyWrong = truth
      .map((t, i) => (greedyNames[i] !== null && greedyNames[i] !== t ? i : -1))
      .filter((i) => i >= 0);
    expect(greedyWrong).toEqual([9, 36]); // R[0] и L[0] — обменялись цветами
    expect(greedyNames[9]).toBe("L");
    expect(greedyNames[36]).toBe("R");
    expect(res.assignment).toEqual(truth);
  });

  it("lets an honest sticker win the contested slot over a glare-blown one", () => {
    const refs = makeRefs();
    // Оранжевая наклейка выбита бликом и читается почти красной (ΔE 6.1 против
    // 20.0), красная — просто тёмная (9.4 против 16.7). По одним только ΔE
    // выгоднее отдать красный слот блику: 6.1+16.7 = 22.8 против 20.0+9.4 = 29.4,
    // и обе наклейки прочитаны неверно. Блик спорит за слот на равных, хотя его
    // цвету верить нельзя вовсе.
    const { labs, centerIdx, truth } = deck((name, cell) => {
      if (name === "L" && cell === 0) return [170, 70, 50];
      if (name === "R" && cell === 0) return [170, 80, 50];
      return baseRGB[name];
    });
    const kept = labs.map((_, i) => (i === 36 ? 0.05 : 1)); // L[0] — выбитая ячейка
    const weights = kept.map((k) => cellWeight(k));

    const blind = assignQuota(labs, refs, centerIdx);
    expect(blind.assignment[36]).toBe("R"); // блик забрал красный слот
    expect(blind.assignment[9]).toBe("L"); // честная красная уехала в оранжевый

    const weighted = assignQuota(labs, refs, centerIdx, undefined, undefined, weights);
    expect(weighted.assignment).toEqual(truth);
  });

  it("survives a missing centre instead of corrupting the deal", () => {
    const refs = makeRefs();
    const { labs, centerIdx } = deck((name) => baseRGB[name]);
    // Центр синей грани «не опознан» — индекса нет.
    const holed = centerIdx.slice(0, 5);
    const res = assignQuota(labs, refs, holed);
    for (const name of COLOR_NAMES) expect(res.counts[name]).toBe(9);
    expect(res.balanced).toBe(true);
  });
});
