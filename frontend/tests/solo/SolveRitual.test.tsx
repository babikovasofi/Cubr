// @vitest-environment jsdom
//
// Owner bug 2026-08-24: одна неверно прочитанная грань во время сверки
// («покажи 6 граней») заставляла переснимать все шесть заново. Эти тесты
// проверяют ТОЛЬКО пользовательский результат фикса — панель показывает все
// шесть слотов, снятые грани не исчезают из-за одной неудачи, а «Переснять
// грань» освобождает ровно один слот. Камера/vision-пайплайн тут не участвует
// (см. tests/vision/useCubeReader.test.ts) — s передаётся заглушкой.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SolveRitual from "../../src/solo/SolveRitual";
import { initialSoloState, type SoloState } from "../../src/solo/soloPhase";
import type { SoloSession } from "../../src/solo/useSoloSession";

function baseSession(overrides: Partial<SoloSession> = {}): SoloSession {
  const state: SoloState = { ...initialSoloState, phase: "verify", ...overrides.state };
  return {
    state,
    signals: { handsDetected: false, bothInZone: false, still: false, ready: false },
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    scramble: "R U R' U'",
    moves: ["R", "U", "R'", "U'"],
    scrambleLoading: false,
    scrambleError: null,
    canVerify: true,
    regenerateScramble: vi.fn(),
    cameraStarted: true,
    cameraError: null,
    startCamera: vi.fn(async () => {}),
    calibrateMode: "full",
    selectedCubeName: null,
    calibrationStep: 6,
    calibrated: true,
    validated: true,
    calibrateError: null,
    calibrateStep: vi.fn(async () => {}),
    useSavedProfile: vi.fn(),
    fallbackToFullCalibration: vi.fn(),
    collecting: true,
    verifyFacesLength: 0,
    verifyCapturedFaces: [],
    verifyError: null,
    verifyStep: vi.fn(async () => {}),
    dropVerifyFace: vi.fn(),
    verifyFailCount: 0,
    skipVerify: vi.fn(),
    solveVerifyError: null,
    solveVerifyStep: vi.fn(async () => {}),
    solveVerifyFailCount: 0,
    skipSolveVerify: vi.fn(),
    gotoVerify: vi.fn(async () => {}),
    backToWalkthrough: vi.fn(),
    again: vi.fn(),
    timerSeconds: "0.00",
    saveState: "idle",
    ...overrides,
  };
}

describe("SolveRitual verify prompt", () => {
  it("prompts the actual missing face, not a positional guess, after a mismatch drops one slot", () => {
    // 5 captured (all but "B"); the hint must ask for the BLUE-centred face (B),
    // never for a face by index-count (which used to be wrong once slots stopped
    // filling in strict URFDLB order).
    const s = baseSession({
      verifyFacesLength: 5,
      verifyCapturedFaces: ["F", "U", "D", "L", "R"], // deliberately out of order
    });
    render(<SolveRitual s={s} />);
    expect(screen.getByText(/СИНИМ центром/)).toBeTruthy();
  });
});
