// Порог уверенности классификации. Смысл: «ближайший эталон победил» — это ещё
// не чтение. Если второй кандидат почти так же близко или ячейку съел блик,
// грань надо переспросить, а не тащить сомнительный цвет в сборку кубика.

import { describe, it, expect } from "vitest";
import {
  confidentCells,
  faceMedianDE,
  stickerConfidence,
} from "../../src/vision/hooks/useCubeReader";
import { normalizeFaceByCenter, rgb2lab, type Refs, type RGB } from "../../src/vision/colors";
import { config } from "../../src/vision/config";

const REF_RGB: Record<string, RGB> = {
  U: [235, 238, 236],
  R: [200, 45, 50],
  F: [30, 175, 90],
  D: [240, 230, 80],
  L: [245, 130, 45],
  B: [30, 110, 200],
};

const REFS: Refs = Object.fromEntries(
  Object.entries(REF_RGB).map(([k, v]) => [k, rgb2lab(v)]),
) as Refs;

const ALL_KEPT = Array.from({ length: 9 }, () => 1);

describe("stickerConfidence", () => {
  it("точный цвет даёт большой отрыв от второго кандидата", () => {
    const out = stickerConfidence(rgb2lab(REF_RGB.F), REFS);
    expect(out.best).toBe("F");
    expect(out.margin).toBeGreaterThan(config.STICKER_MARGIN_MIN);
    expect(out.d).toBeLessThan(2);
  });

  it("цвет ровно между красным и оранжевым отрыва не даёт", () => {
    const between: RGB = [222, 88, 48];
    const out = stickerConfidence(rgb2lab(between), REFS);
    expect(out.margin).toBeLessThan(config.STICKER_MARGIN_MIN);
  });
});

describe("confidentCells", () => {
  it("чистая грань уверена во всех девяти ячейках", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    expect(confidentCells(labs, REFS, ALL_KEPT)).toBe(9);
  });

  it("ячейка, где блик съел пиксели, уверенной не считается", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    const kept = [...ALL_KEPT];
    kept[3] = 0.05;
    expect(confidentCells(labs, REFS, kept)).toBe(8);
  });

  it("цвет далеко от всех эталонов (мимо кубика) уверенным не считается", () => {
    const labs = Array.from({ length: 9 }, () => rgb2lab(REF_RGB.U));
    // Тёмно-серая стена: далека от всех шести эталонов, но ни к одному не
    // «прилипает» — ровно случай «рамка съехала с кубика».
    labs[0] = rgb2lab([88, 84, 90]);
    expect(confidentCells(labs, REFS, ALL_KEPT)).toBe(8);
  });
});

// Живой отказ 2026-08-03 (LED, монолитный кубик, /accuracy): вместо зелёной
// грани в рамку попал стол. Числа ниже — из отчёта того прогона, не выдуманные.
describe("faceMedianDE — «в рамке вообще не кубик»", () => {
  // Шесть эталонов ровно те, что сняла камера в живом прогоне.
  const LIVE_REFS: Refs = {
    U: [88, -3, -7],
    R: [47, 61, 42],
    F: [57, -53, 31],
    D: [84, -16, 72],
    L: [70, 39, 42],
    B: [35, 20, -57],
  };
  // Девять ячеек стола: нейтральный серо-бежевый, R даже чуть больше G — зелёная
  // грань в тени так выглядеть не может.
  const TABLE: RGB[] = [
    [164, 158, 148],
    [159, 156, 145],
    [159, 156, 144],
    [160, 164, 148],
    [156, 159, 144],
    [158, 157, 141],
    [162, 161, 148],
    [164, 163, 144],
    [157, 158, 140],
  ];

  it("стол вместо грани ловится с запасом над порогом", () => {
    const de = faceMedianDE(TABLE.map(rgb2lab), LIVE_REFS);
    // В отчёте живого прогона было 20.6.
    expect(de).toBeGreaterThan(config.FACE_MAX_MEDIAN_DE);
    expect(de).toBeGreaterThan(19);
  });

  // Замок обязан оставлять здоровой грани большой запас, иначе он выключит гейт
  // вместо того, чтобы его защитить.
  it("здоровая грань лежит далеко ниже порога", () => {
    const de = faceMedianDE(
      Array.from({ length: 9 }, () => LIVE_REFS.F),
      LIVE_REFS,
    );
    expect(de).toBeLessThan(config.FACE_MAX_MEDIAN_DE / 2);
  });

  // Почему стол ловит именно РАССТОЯНИЕ, а не уверенность.
  //
  // Уверенность спрашивает «какой из шести цветов и с каким отрывом», и с тех
  // пор, как этот вопрос решается метрикой с ослабленной светлотой
  // (colors.deltaEClassify), серый стол отвечает на него бойко: он безусловно
  // «белый», потому что от белого его отличала как раз светлота. Это не поломка
  // уверенности, это её область определения — она про различимость цветов
  // между собой, а не про принадлежность кубику.
  //
  // Отсюда и разделение труда: стол отсекается расстоянием (FACE_MAX_MEDIAN_DE,
  // обычная метрика, где светлота весит полностью), и отсекается ДО нормировки —
  // потому что нормировка тянет грань за её собственный центр к ближайшему
  // эталону, серый едет к белому, и после неё улики уже нет.
  it("стол ловится расстоянием, а не уверенностью, и только до нормировки", () => {
    const raw = TABLE.map(rgb2lab);
    // До нормировки: расстояние ловит.
    expect(faceMedianDE(raw, LIVE_REFS)).toBeGreaterThan(config.FACE_MAX_MEDIAN_DE);
    // Уверенность стол НЕ ловит — и именно поэтому одного её порога не хватало.
    expect(confidentCells(raw, LIVE_REFS, ALL_KEPT)).toBeGreaterThanOrEqual(
      config.FACE_MIN_CONFIDENT_CELLS,
    );

    // После нормировки не ловит уже ничто: замок обязан стоять раньше неё.
    const fixed = normalizeFaceByCenter(TABLE, LIVE_REFS.U).map(rgb2lab);
    expect(confidentCells(fixed, LIVE_REFS, ALL_KEPT)).toBe(9);
    expect(faceMedianDE(fixed, LIVE_REFS)).toBeLessThan(config.FACE_MAX_MEDIAN_DE);
  });
});
