// Отказ раскладки граней по центрам: что именно человек читает на экране.
//
// Живой прогон 2026-08-05 дал три подряд дропа `assign` и сообщение
// «Съёмка 5 не опознана: её центр в 30.0 от цвета F (допустимо 34)» — число
// меньше порога, то есть текст опровергал сам себя. Сработал ДРУГОЙ замок
// (относительный), а печатался порог абсолютного; и назывался первый нарушитель,
// а не худший (шестая съёмка была на ΔE 55).

import { describe, it, expect } from "vitest";

import { assignFacesByCenter } from "../../src/vision/cubeGrid";
import { rgb2lab, type Lab, type Refs, type RGB } from "../../src/vision/colors";
import { config } from "../../src/vision/config";
import { centerAssignFailedRu } from "../../src/vision/guide";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};
const REFS = Object.fromEntries(Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)])) as Refs;

/** Съёмка, у которой значим только центр (ячейка 4). */
function captureWithCentre(lab: Lab): Lab[] {
  return Array.from({ length: 9 }, () => lab);
}

describe("centerAssignFailedRu", () => {
  it("при относительном замке печатает ЕГО порог, а не абсолютный", () => {
    const msg = centerAssignFailedRu(
      [{ capture: 4, face: "F", de: 30, relative: true }],
      3.7,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    // Раньше здесь стояло «допустимо 34» при ΔE 30 — самоопровержение.
    expect(msg).not.toContain(`допустимо ${config.CENTER_MAX_DELTA_E}`);
    expect(msg).toContain(String(config.CENTER_OUTLIER_DE));
    expect(msg).toContain("3.7");
  });

  it("при абсолютном замке печатает абсолютный порог", () => {
    const msg = centerAssignFailedRu(
      [{ capture: 5, face: "B", de: 55, relative: false }],
      3.7,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).toContain(`допустимо ${config.CENTER_MAX_DELTA_E}`);
  });

  it("называет ХУДШУЮ съёмку, а не первую", () => {
    const msg = centerAssignFailedRu(
      [
        { capture: 4, face: "F", de: 30, relative: true },
        { capture: 5, face: "B", de: 55, relative: false },
      ],
      3.7,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).toContain("Съёмка 6");
    expect(msg).toContain("55");
    expect(msg).not.toContain("Съёмка 5 не опознана");
  });

  it("называет цветом центры, которых не увидел — по всем нарушителям", () => {
    const msg = centerAssignFailedRu(
      [
        { capture: 4, face: "F", de: 30, relative: true },
        { capture: 5, face: "B", de: 55, relative: false },
      ],
      3.7,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).toContain("зелёным");
    expect(msg).toContain("синим");
    expect(msg).toContain("дважды");
  });

  it("пустой список нарушителей не роняет текст", () => {
    expect(centerAssignFailedRu([], 0, 34, 18)).toContain("не опознаны");
  });
});

describe("assignFacesByCenter собирает всех нарушителей", () => {
  it("две непоказанные грани видны обе, худшая идёт в offender", () => {
    // Ровно живой сценарий: четыре грани показаны честно, а вместо зелёной и
    // синей человек дважды показал белую и красную. Бижекция обязана раздать
    // шесть цветов, поэтому лишние съёмки получают зелёный и синий с огромным ΔE.
    const grids = [
      captureWithCentre(REFS.U),
      captureWithCentre(REFS.R),
      captureWithCentre(REFS.L),
      captureWithCentre(REFS.D),
      captureWithCentre(REFS.U),
      captureWithCentre(REFS.R),
    ];
    const res = assignFacesByCenter(grids, REFS);

    expect(res.ok).toBe(false);
    expect(res.offenders?.length).toBe(2);
    // Непоказанные центры — зелёный и синий.
    expect(res.offenders?.map((o) => o.face).sort()).toEqual(["B", "F"]);
    // offender — худший из них, а не первый по порядку.
    const worstDE = Math.max(...(res.offenders ?? []).map((o) => o.de));
    expect(res.offender?.de).toBe(worstDE);
  });

  it("шесть честных граней проходят без нарушителей", () => {
    const grids = (["U", "R", "F", "D", "L", "B"] as const).map((f) => captureWithCentre(REFS[f]));
    const res = assignFacesByCenter(grids, REFS);
    expect(res.ok).toBe(true);
    expect(res.offenders).toBeUndefined();
  });
});
