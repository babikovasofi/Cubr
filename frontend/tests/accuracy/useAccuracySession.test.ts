// @vitest-environment jsdom
//
// HONESTY BARRIER (skeptic constraint #6): the accuracy harness must ALWAYS measure
// a fresh full 6-face calibration and must NEVER seed from a stored profile (nor
// quick-adjust). Seeding would fold a prior baseline into the very error we claim to
// measure. This test mounts the hook and asserts seedProfile/quickAdjust are never
// invoked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { readerStub } = vi.hoisted(() => ({
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
  useScramble: () => ({
    scramble: "",
    moves: [],
    loading: false,
    error: null,
    regenerate: vi.fn(),
    expectedFacelets: null,
  }),
}));

import { useAccuracySession } from "../../src/accuracy/useAccuracySession";

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
});
