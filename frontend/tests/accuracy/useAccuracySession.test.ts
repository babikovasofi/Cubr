// @vitest-environment jsdom
//
// HONESTY BARRIER (skeptic constraint #6): the accuracy harness must ALWAYS measure
// a fresh full 6-face calibration and must NEVER seed from a stored profile (nor
// quick-adjust). Seeding would fold a prior baseline into the very error we claim to
// measure. This test mounts the hook and asserts seedProfile/quickAdjust are never
// invoked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { readerStub, scrambleStub } = vi.hoisted(() => ({
  // Эталон живёт в изменяемой заглушке: тест «скрамбл не собран» обязан задать
  // скрамблированный эталон, иначе проверять нечего.
  scrambleStub: {
    scramble: "",
    moves: [] as string[],
    loading: false,
    error: null as string | null,
    regenerate: () => {},
    expectedFacelets: null as string | null,
  },
  readerStub: {
    seedProfile: vi.fn(),
    quickAdjust: vi.fn(),
    calibrated: false,
    seeded: false,
    validated: false,
    calibrationStep: 0,
    collectingAccuracy: false,
    accFacesLength: 0,
    verifyFacesLength: 0,
    collecting: false,
    readFace: vi.fn(),
    guideRegionLuma: vi.fn(),
    captureCalibration: vi.fn(),
    getProfile: () => null,
    recalibrate: vi.fn(),
    beginVerify: vi.fn(),
    pushVerifyFace: vi.fn(),
    resetVerify: vi.fn(),
    beginAccuracy: vi.fn(),
    pushAccuracyFace: vi.fn(),
    resetAccuracy: vi.fn(),
  },
}));

vi.mock("../../src/vision/hooks/useCubeReader", () => ({
  useCubeReader: () => readerStub,
}));
vi.mock("../../src/vision/hooks/useCamera", () => ({
  useCamera: () => ({ start: vi.fn(), stop: vi.fn(), isLive: () => false }),
  CameraError: class CameraError extends Error {
    kind = "denied";
  },
}));
vi.mock("../../src/scramble/hooks/useScramble", () => ({
  useScramble: () => scrambleStub,
}));

import { useAccuracySession } from "../../src/accuracy/useAccuracySession";
import { scrambleToFacelets } from "../../src/vision/cubeState";
import { rotateFacelets } from "../../src/vision/faceletRotations";

describe("useAccuracySession — honesty barrier", () => {
  beforeEach(() => {
    readerStub.seedProfile.mockClear();
    readerStub.quickAdjust.mockClear();
  });

  it("never seeds from a profile nor quick-adjusts (always a fresh full calibration)", () => {
    const { result, rerender } = renderHook(() => useAccuracySession());
    rerender();
    expect(readerStub.seedProfile).not.toHaveBeenCalled();
    expect(readerStub.quickAdjust).not.toHaveBeenCalled();
    // Sanity: the session mounted and exposes its calibration surface.
    expect(result.current.calibrated).toBe(false);
  });

  // Диагностика ячеек нужна именно в отчёте: по нему разбирают, пересвет виноват,
  // геометрия или слипшиеся эталоны. Если она не доезжает до буфера обмена, её
  // как будто нет.
  it("доносит поячеечную диагностику из съёмки в отчёт", async () => {
    const grid = (c: string): string[] => Array.from({ length: 9 }, () => c);
    const grids = (): string[][] => ["U", "R", "F", "D", "L", "B"].map(grid);
    // Сырое чтение промахнулось в первой ячейке — иначе промахов нет и приписывать
    // диагностику некуда.
    const raw = grids();
    raw[0][0] = "L";

    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: raw,
      productFaceGrids: grids(),
      // Первая ячейка прочиталась мимо и выбита пересветом — ровно то, что
      // отчёт должен показать словами, а не оставить на догадки.
      cellDiags: Array.from({ length: 54 }, (_, i) =>
        i === 0
          ? { rgb: [210, 150, 120], kept: 0.04, best: "L", bestDE: 7, second: "U", secondDE: 9 }
          : { rgb: [235, 238, 236], kept: 0.9, best: "U", bestDE: 2, second: "D", secondDE: 40 },
      ),
      // Две грани из шести подгонка не приняла — на монолитном кубике это
      // штатный исход, и отчёт обязан назвать его, а не молча резать по рамке.
      fitDiags: [
        { gain: 6.2, used: true, gap: 20 },
        { gain: 0.3, used: false, gap: 3 },
        { gain: 5.0, used: true, gap: 18 },
        { gain: 0.2, used: false, gap: 2 },
        { gain: 4.4, used: true, gap: 16 },
        { gain: 3.9, used: true, gap: 15 },
      ],
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    // В тесте камера не смонтирована, а без video съёмка выходит на первой строке.
    result.current.videoRef.current = {} as HTMLVideoElement;
    // Первое нажатие только начинает чтение, съёмку делает второе.
    await act(async () => {
      await result.current.captureFace();
    });

    const out = result.current.buildExport();
    expect(out).toContain("kept 4% (ВЫБИТА)");
    expect(out).toContain("Почему ошиблись");
    expect(out).toContain("выбитых пересветом");
    expect(out).toContain("Подгонка сетки");
    expect(out).toContain("откатов на рамку: 2 из 6");
  });

  // Промах наводки на одной грани не должен стоить целого чтения: остальные
  // грани сняты честно и лежат в коллекторе. Если бы харнесс бросал всё в дроп,
  // за двадцать чтений тестировщик потерял бы больше времени на пересъёмку, чем
  // на сам замер, — и это при том, что камера сама сказала, что делать.
  it("«сняли не кубик» не бракует чтение и не пишет дроп", async () => {
    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "unreadable",
      reason: "not-a-face",
      diag: "В рамке не грань кубика: медиана ΔE 20.6",
    });
    readerStub.resetAccuracy.mockClear();

    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.captureError).toContain("не грань кубика");
    // Ни «повтори грань» поверх собственного объяснения, ни сброса коллектора.
    expect(result.current.captureError).not.toContain("Грань не прочиталась");
    expect(readerStub.resetAccuracy).not.toHaveBeenCalled();
    expect(result.current.buildExport()).not.toContain("unreadable");
  });

  // Живой отказ: кубик сняли, не собрав на нём скрамбл. Зрение прочитало каждую
  // грань верно, а совпало 15/54 — случайный уровень. Такое чтение обязано
  // остаться за пределами точности: иначе гейт меряет память тестировщика.
  it("собранный кубик при скрамблированном эталоне не идёт в точность", async () => {
    const uniform = (c: string): string[] => Array.from({ length: 9 }, () => c);
    const grids = (): string[][] => ["U", "R", "F", "D", "L", "B"].map(uniform);

    scrambleStub.scramble = "R U";
    scrambleStub.moves = ["R", "U"];
    // Эталон отличается от собранного — иначе замер и есть санити-режим.
    scrambleStub.expectedFacelets = scrambleToFacelets("R U");

    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: grids(),
      productFaceGrids: grids(),
      cellDiags: [],
      fitDiags: [],
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.captureError).toContain("скрамбл не собран");
    // Ни отчёта, ни строки точности — только дроп с честной причиной.
    expect(result.current.lastReport).toBeNull();
    const out = result.current.buildExport();
    expect(out).not.toContain("Per-sticker accuracy");
    expect(out).toContain("mis-scramble");

    scrambleStub.expectedFacelets = null;
  });

  // Кубик собран правильно, но показан повёрнутым: чтение совпадает с эталоном
  // с точностью до поворота, а по фиксированному выравниванию разваливается.
  // Цвета тут прочитаны верно — записывать зрению чужую ошибку нельзя. Считать
  // по подобранной ориентации тоже нельзя: выравнивание под ответ и есть
  // survivorship bias, ради запрета которого порядок захвата зафиксирован.
  it("тот же кубик в другой ориентации не идёт ни в точность, ни в подогнанный счёт", async () => {
    const truth = scrambleToFacelets("R U F");
    // k=1 — целиком повёрнутый кубик: тот же физический скрамбл, другая хватка.
    const turned = rotateFacelets(truth, 1);
    const grids = (): string[][] =>
      Array.from({ length: 6 }, (_, f) => turned.slice(f * 9, f * 9 + 9).split(""));

    scrambleStub.scramble = "R U F";
    scrambleStub.moves = ["R", "U", "F"];
    scrambleStub.expectedFacelets = truth;

    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: grids(),
      productFaceGrids: grids(),
      cellDiags: [],
      fitDiags: [],
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.captureError).toContain("другой ориентации");
    expect(result.current.lastReport).toBeNull();
    const out = result.current.buildExport();
    expect(out).not.toContain("Per-sticker accuracy");
    expect(out).toContain("orientation");

    scrambleStub.expectedFacelets = null;
  });

  // Замок на ориентацию обязан быть узким. Если бы он глотал любое расхождение,
  // гейт стало бы нечем провалить: настоящая ошибка классификации ушла бы в
  // дропы под видом «не так держал».
  it("настоящие ошибки цвета скорятся, а не списываются на ориентацию", async () => {
    const truth = scrambleToFacelets("R U F");
    const read = truth.split("");
    // Десять наклеек прочитаны неверно — столько не объяснить никаким поворотом.
    for (let i = 0; i < 10; i++) read[i * 5] = read[i * 5] === "U" ? "R" : "U";
    const grids = (): string[][] =>
      Array.from({ length: 6 }, (_, f) => read.slice(f * 9, f * 9 + 9));

    scrambleStub.scramble = "R U F";
    scrambleStub.moves = ["R", "U", "F"];
    scrambleStub.expectedFacelets = truth;

    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: grids(),
      productFaceGrids: grids(),
      cellDiags: [],
      fitDiags: [],
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.lastReport).not.toBeNull();
    expect(result.current.lastReport!.correct).toBeLessThan(54);
    expect(result.current.buildExport()).toContain("Per-sticker accuracy");

    scrambleStub.expectedFacelets = null;
  });
  // Прогон 2026-08-19 (stickerless, LED) ушёл в дроп целиком, и «Копировать
  // отчёт» отдал сводку из одних нулей: причина жила строкой на экране и в
  // буфер не попадала. Диагностика, которую нельзя скопировать, пересказывается
  // руками — то есть теряется.
  it("брак на раскладке центров уезжает в отчёт вместе с ячейками съёмок", async () => {
    const uniform = (c: string): string[] => Array.from({ length: 9 }, () => c);
    const grids = (): string[][] => ["U", "R", "F", "D", "L", "B"].map(uniform);

    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: grids(),
      productFaceGrids: grids(),
      // Раскладка отказала: две съёмки тянутся к одному цвету.
      rawCenterFaces: null,
      rawCenterOffenders: [
        { capture: 4, face: "B", de: 46.4, relative: true, own: "R", ownDE: 5, duplicateOf: 1 },
      ],
      rawCenterSpread: {
        faces: ["F", "R", "D", "U", "B", "L"],
        des: [3, 3, 2, 38, 46, 43],
        medianDE: 20.4,
        own: ["F", "R", "D", "D", "R", "D"],
        ownDes: [3, 3, 2, 2, 5, 3],
        rgb: [
          [0, 185, 95],
          [249, 79, 75],
          [216, 219, 76],
          [216, 216, 75],
          [255, 83, 87],
          [211, 211, 68],
        ],
      },
      cellDiags: Array.from({ length: 54 }, () => ({
        rgb: [200, 200, 200] as [number, number, number],
        kept: 0.9,
        best: "U",
        bestDE: 3,
        second: "D",
        secondDE: 40,
      })),
      fitDiags: Array.from({ length: 6 }, () => ({ gain: 5, used: true, gap: 18 })),
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    await act(async () => result.current.setGrip("picture"));
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    // На экране — причина и сама грань, а не один центр.
    expect(result.current.captureError).toContain("не опознана");
    expect(result.current.captureError).toContain("Ячейки съёмок");

    const out = result.current.buildExport();
    expect(out).toContain("=== Последний брак (дроп) ===");
    expect(out).toContain("Ячейки съёмок");
    expect(out).toContain("assign");
    // Брак стоит ПЕРЕД сводкой: сводка из нулей без причины бесполезна.
    expect(out.indexOf("Последний брак")).toBeLessThan(out.indexOf("=== Сводка прогона ==="));
  });

  it("сброс прогона убирает брак из отчёта", async () => {
    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    await act(async () => result.current.setGrip("picture"));
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });
    expect(result.current.buildExport()).toContain("Последний брак");
    await act(async () => result.current.resetRun());
    expect(result.current.buildExport()).not.toContain("Последний брак");
  });
  // Замок решётки просит переснять ОДНУ грань — как и «сняли не кубик». Если бы
  // он бросал всё чтение в дроп, тестировщик терял бы пять честно снятых граней
  // из-за одной, и drop-rate гейта наполнялся бы отказами инструмента, а не
  // ошибками зрения.
  it("«нет решётки» не бракует чтение и не пишет дроп", async () => {
    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "unreadable",
      reason: "no-lattice",
      diag: "Грань U снята мимо: у неё нет решётки — контраст границ 5.3 при 41.9 у соседних граней",
    });
    readerStub.resetAccuracy.mockClear();

    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    result.current.videoRef.current = {} as HTMLVideoElement;
    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.captureError).toContain("нет решётки");
    expect(result.current.captureError).not.toContain("Грань не прочиталась");
    expect(readerStub.resetAccuracy).not.toHaveBeenCalled();
    expect(result.current.buildExport()).not.toContain("Последний брак");
  });
});

// Три дропа подряд — это и есть случай, ради которого брак начали запоминать.
// Кнопка «Копировать отчёт» гасла ровно в нём: считанных чтений нет, условий в
// прогоне нет, значит копировать «нечего». Отчёт обязан быть доступен, пока
// есть хоть одна причина отказа.
describe("отчёт доступен и без единого засчитанного чтения", () => {
  it("после брака сессия отдаёт его текст наружу", async () => {
    const uniform = (c: string): string[] => Array.from({ length: 9 }, () => c);
    readerStub.calibrated = true;
    readerStub.collectingAccuracy = true;
    readerStub.pushAccuracyFace.mockResolvedValue({
      kind: "complete",
      rawFaceGrids: ["U", "R", "F", "D", "L", "B"].map(uniform),
      productFaceGrids: ["U", "R", "F", "D", "L", "B"].map(uniform),
      rawCenterFaces: null,
      rawCenterOffenders: [{ capture: 5, face: "B", de: 55.6, relative: true, own: "F", ownDE: 4 }],
      cellDiags: [],
      fitDiags: [],
      resolved: null,
    });

    const { result } = renderHook(() => useAccuracySession());
    await act(async () => result.current.setMode("solved"));
    await act(async () => result.current.setGrip("picture"));
    result.current.videoRef.current = {} as HTMLVideoElement;
    expect(result.current.lastDropText).toBeNull();

    await act(async () => {
      await result.current.captureFace();
    });

    expect(result.current.lastReport).toBeNull(); // считанных чтений нет
    expect(result.current.lastDropText).toContain("не опознана");
  });
});
