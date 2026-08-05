// @vitest-environment jsdom
//
// Block B calibrate fixes:
//  - useSavedProfile(): a registered cube skips the re-scan (seed + advance).
//  - full-calibration captureCalibration() returning false (empty/dark frame)
//    must NOT advance and must surface the unreadable error.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CubeReader } from "../../src/vision/hooks/useCubeReader";
import type { ColorProfile } from "../../src/api/cubes";

const { useCubesStoreMock } = vi.hoisted(() => ({ useCubesStoreMock: vi.fn() }));
vi.mock("../../src/store/cubesStore", () => ({ useCubesStore: useCubesStoreMock }));

import { useCalibrate } from "../../src/solo/useCalibrate";

const LAB: [number, number, number] = [50, 0, 0];
const PROFILE: ColorProfile = { U: LAB, R: LAB, F: LAB, D: LAB, L: LAB, B: LAB };

function makeReader(overrides: Partial<CubeReader> = {}): CubeReader {
  const base = {
    calibrationStep: 0,
    calibrated: false,
    validated: false,
    seedProfile: vi.fn(),
    quickAdjust: vi.fn(),
    captureCalibration: vi.fn(() => true),
    getProfile: vi.fn(() => null),
    recalibrate: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as CubeReader;
}

function stubCubes(selectedCubeId: string | null, list: unknown[]): void {
  useCubesStoreMock.mockImplementation((sel: (s: unknown) => unknown) =>
    sel({ selectedCubeId, list }),
  );
}

const VIDEO = {} as HTMLVideoElement;

function renderCalibrate(reader: CubeReader, onCalibrated = vi.fn()) {
  const utils = renderHook(() =>
    useCalibrate({
      reader,
      videoRef: { current: VIDEO },
      phase: "calibrate",
      cameraStarted: true,
      startCamera: vi.fn(async () => {}),
      onCalibrated,
    }),
  );
  return { ...utils, onCalibrated };
}

beforeEach(() => {
  useCubesStoreMock.mockReset();
});

describe("useCalibrate — useSavedProfile (skip re-scan)", () => {
  it("seeds the stored profile and advances without a camera scan", () => {
    stubCubes("cube-1", [{ id: "cube-1", name: "MoYu", color_profile: PROFILE }]);
    const reader = makeReader();
    const { result, onCalibrated } = renderCalibrate(reader);

    expect(result.current.calibrateMode).toBe("quick");
    act(() => result.current.useSavedProfile());

    expect(reader.seedProfile).toHaveBeenCalled();
    expect(onCalibrated).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no cube (profile) is selected", () => {
    stubCubes(null, []);
    const reader = makeReader();
    const { result, onCalibrated } = renderCalibrate(reader);

    expect(result.current.calibrateMode).toBe("full");
    act(() => result.current.useSavedProfile());
    expect(onCalibrated).not.toHaveBeenCalled();
  });
});

describe("useCalibrate — full calibration presence gate", () => {
  it("does not advance and shows an error when the frame is unreadable", async () => {
    stubCubes(null, []); // no profile → full 6-face mode
    const reader = makeReader({ captureCalibration: vi.fn(() => false) });
    const { result, onCalibrated } = renderCalibrate(reader);

    await act(async () => {
      await result.current.calibrateStep();
    });

    expect(reader.captureCalibration).toHaveBeenCalledTimes(1);
    expect(onCalibrated).not.toHaveBeenCalled();
    expect(result.current.calibrateError).toBeTruthy();
  });

  it("advances once a readable capture completes the profile", async () => {
    stubCubes(null, []);
    const reader = makeReader({
      captureCalibration: vi.fn(() => true),
      getProfile: vi.fn(() => PROFILE as unknown as ReturnType<CubeReader["getProfile"]>),
    });
    const { result, onCalibrated } = renderCalibrate(reader);

    await act(async () => {
      await result.current.calibrateStep();
    });

    expect(reader.captureCalibration).toHaveBeenCalledTimes(1);
    expect(onCalibrated).toHaveBeenCalledTimes(1);
    expect(result.current.calibrateError).toBeNull();
  });
});
