// Два пути чтения одного и того же снимка: СЫРОЙ (по нему гейт 0.3) и
// ПРОДУКТОВЫЙ (нормировка света по центру + квоты 9×6). Разделение важно: если
// подпорки продукта попадут в гейт, планка перестанет мерить само зрение.

import { describe, it, expect } from "vitest";
import { normalizeSamples } from "../../src/vision/hooks/useCubeReader";
import { assignQuota, rgb2lab, applyLightGain, type Refs, type RGB } from "../../src/vision/colors";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;
const ORDER = ["U", "R", "F", "D", "L", "B"] as const;

/** Собранный кубик: каждая грань — девять своих наклеек. */
function solvedSamples(gain?: [number, number, number]) {
  return ORDER.map((name) => {
    const rgb = Array.from({ length: 9 }, () =>
      gain ? applyLightGain(REF_RGB[name], gain) : REF_RGB[name],
    );
    return { rgb, lab: rgb.map((c) => rgb2lab(c)), kept: Array(9).fill(1) };
  });
}

describe("normalizeSamples", () => {
  it("снимает уехавший свет со всех граней", () => {
    const warm: [number, number, number] = [1.22, 1.0, 0.72];
    const drifted = solvedSamples(warm);
    const fixed = normalizeSamples(drifted, REFS);

    fixed.forEach((face, i) => {
      const name = ORDER[i];
      const before = drifted[i].lab[0];
      const after = face[0];
      const dBefore = Math.abs(before[1] - REFS[name][1]) + Math.abs(before[2] - REFS[name][2]);
      const dAfter = Math.abs(after[1] - REFS[name][1]) + Math.abs(after[2] - REFS[name][2]);
      expect(dAfter, `грань ${name}`).toBeLessThanOrEqual(dBefore);
    });
  });
});

describe("квоты 9×6", () => {
  it("возвращают одиночный промах на место", () => {
    const samples = solvedSamples();
    // Одна белая наклейка выбита в пересвет и «покраснела».
    samples[0].rgb[1] = [214, 96, 74];
    samples[0].lab[1] = rgb2lab(samples[0].rgb[1]);

    const labs = samples.flatMap((s) => s.lab);
    const centerIdx = ORDER.map((_, i) => i * 9 + 4);
    const { assignment, balanced } = assignQuota(labs, REFS, centerIdx);

    expect(balanced).toBe(true);
    // Квоты по красному уже выбраны настоящими красными — спорная наклейка
    // возвращается в белые.
    expect(assignment[1]).toBe("U");
    expect(assignment.filter((a) => a === "R")).toHaveLength(9);
  });
});
