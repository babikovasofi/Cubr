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
import { centerAssignFailedRu, centerSpreadRu } from "../../src/vision/guide";

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

  it("называет цветом центры, которых не увидел — но только у настоящих дубликатов", () => {
    const msg = centerAssignFailedRu(
      [
        { capture: 4, face: "F", de: 30, relative: true, own: "U", ownDE: 2, duplicateOf: 0 },
        { capture: 5, face: "B", de: 55, relative: false, own: "R", ownDE: 3, duplicateOf: 1 },
      ],
      3.7,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).toContain("зелёным");
    expect(msg).toContain("синим");
    expect(msg).toContain("дважды");
  });

  it("НЕ обвиняет в повторе, когда центр просто прочитан плохо", () => {
    // Живой прогон 2026-08-05 (stickerless): съёмка 1 села на жёлтый с ΔE 35,
    // но и к своему ближайшему цвету была далека — грани показаны все, плохо
    // прочитан центр. Прежний текст уверенно заявлял «не показала жёлтую».
    const msg = centerAssignFailedRu(
      [{ capture: 0, face: "D", de: 35.2, relative: true, own: "U", ownDE: 28.4 }],
      10,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).not.toContain("дважды");
    expect(msg).not.toContain("не показала");
    expect(msg).toContain("центр прочитан плохо");
    expect(msg).toContain("28.4");
  });

  it("смешанный случай: и повтор, и плохой центр — говорит про оба", () => {
    const msg = centerAssignFailedRu(
      [
        { capture: 0, face: "D", de: 35, relative: true, own: "U", ownDE: 28 },
        { capture: 3, face: "F", de: 40, relative: true, own: "R", ownDE: 2, duplicateOf: 1 },
      ],
      10,
      config.CENTER_MAX_DELTA_E,
      config.CENTER_OUTLIER_DE,
    );
    expect(msg).toContain("дважды");
    expect(msg).toContain("центр прочитан плохо");
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

describe("centerSpreadRu", () => {
  it("показывает СВОЙ цвет центра, а не только назначенный", () => {
    // Живой прогон 2026-08-05 (stickerless, LED): «1:L 37 … 5:U 1» читалось как
    // «первая съёмка — плохая оранжевая», хотя камера видела ДВА белых центра.
    const msg = centerSpreadRu(
      ["L", "R", "F", "D", "U", "B"],
      [37, 2, 5, 3, 1, 15],
      3.8,
      ["U", "R", "F", "D", "U", "B"],
      [4, 2, 5, 3, 1, 15],
      [
        [230, 234, 231],
        [220, 60, 60],
        [10, 180, 95],
        [235, 230, 70],
        [228, 236, 240],
        [10, 70, 170],
      ],
    );
    // Обе съёмки тянутся к белому — вот что надо было увидеть сразу.
    expect(msg).toContain("1:L 37 (сам U 4)");
    expect(msg).toContain("5:U 1 (сам U 1)");
    expect(msg).toContain("RGB(230,234,231)");
  });

  it("без новых данных остаётся прежней строкой", () => {
    const msg = centerSpreadRu(["U", "R", "F", "D", "L", "B"], [1, 2, 3, 4, 5, 6], 3.5);
    expect(msg).toContain("1:U 1");
    expect(msg).not.toContain("сам");
    expect(msg).not.toContain("RGB");
  });
});
