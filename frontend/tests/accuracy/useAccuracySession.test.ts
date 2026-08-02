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
});
