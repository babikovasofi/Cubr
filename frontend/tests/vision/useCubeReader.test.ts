// @vitest-environment jsdom
//
// The honesty-critical quick-adjust MATH + gating (von-Kries, wrong-face, diverged)
// is unit-tested as pure functions in colors.test.ts (no canvas). Here we cover the
// hook wiring that a pure test cannot reach: seedProfile flag state, session-local
// clone isolation, and the readable-gate guard.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCubeReader } from "../../src/vision/hooks/useCubeReader";
import type { Refs } from "../../src/vision/colors";

const nullCanvasRef = { current: null } as React.RefObject<HTMLCanvasElement | null>;

const PROFILE: Refs = {
  U: [96, 0, 2],
  R: [50, 60, 40],
  F: [55, -45, 30],
  D: [90, -5, 80],
  L: [62, 40, 55],
  B: [40, 10, -45],
};

describe("useCubeReader.seedProfile", () => {
  it("marks the reader calibrated + seeded + NOT validated (casual-only, HIGH#4)", () => {
    const { result } = renderHook(() => useCubeReader(nullCanvasRef));
    expect(result.current.calibrated).toBe(false);
    expect(result.current.seeded).toBe(false);

    act(() => result.current.seedProfile(PROFILE));

    expect(result.current.calibrated).toBe(true);
    expect(result.current.seeded).toBe(true);
    expect(result.current.validated).toBe(false);
    expect(result.current.calibrationStep).toBe(6); // fully "calibrated" from the profile
    expect(result.current.getProfile()).toEqual(PROFILE);
  });

  it("seeds a CLONE: mutating the source profile does not leak into the reader refs", () => {
    const src: Refs = { ...PROFILE, U: [...PROFILE.U] };
    const { result } = renderHook(() => useCubeReader(nullCanvasRef));
    act(() => result.current.seedProfile(src));
    // Mutate the caller's object after seeding.
    src.U[0] = 12345;
    expect(result.current.getProfile()!.U[0]).toBe(PROFILE.U[0]);
  });

  it("recalibrate clears seeded + validated and drops the refs", () => {
    const { result } = renderHook(() => useCubeReader(nullCanvasRef));
    act(() => result.current.seedProfile(PROFILE));
    act(() => result.current.recalibrate());
    expect(result.current.calibrated).toBe(false);
    expect(result.current.seeded).toBe(false);
    expect(result.current.validated).toBe(false);
    expect(result.current.calibrationStep).toBe(0);
  });
});

describe("useCubeReader.quickAdjust guard", () => {
  it("returns unreadable when there is no work canvas (readable gate)", () => {
    const { result } = renderHook(() => useCubeReader(nullCanvasRef));
    act(() => result.current.seedProfile(PROFILE));
    const fakeVideo = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const r = result.current.quickAdjust(fakeVideo);
    expect(r.kind).toBe("unreadable");
  });
});
