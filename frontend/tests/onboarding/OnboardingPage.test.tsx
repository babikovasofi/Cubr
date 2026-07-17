// @vitest-environment jsdom
//
// Regression for the same "camera never starts" dead end as
// tests/cubes/CubeRegisterWizard.test.tsx, this time in onboarding step 2
// ("Проверка камеры" — OnboardingPage's CameraStep). Root cause was
// identical: <CameraStage> (the <video ref={cam.videoRef}> owner) was
// rendered ONLY once `cam.started` was already true, but
// useCameraCheck.start() → useCamera's start() requires cam.videoRef.current
// to be a mounted DOM node BEFORE it runs — a chicken-and-egg dead end where
// the enable button could never succeed.
//
// This test proves the fix structurally: CameraStage/<video> is mounted on
// step 2's first render, before the user ever clicks "Включить камеру".

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CameraCheck } from "../../src/onboarding/useCameraCheck";

const { useCameraCheckMock } = vi.hoisted(() => ({ useCameraCheckMock: vi.fn() }));
vi.mock("../../src/onboarding/useCameraCheck", async () => {
  const actual = await vi.importActual<typeof import("../../src/onboarding/useCameraCheck")>(
    "../../src/onboarding/useCameraCheck",
  );
  return { ...actual, useCameraCheck: useCameraCheckMock };
});

import OnboardingPage from "../../src/pages/OnboardingPage";

function stubCam(overrides: Partial<CameraCheck> = {}): CameraCheck {
  return {
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    started: false,
    handsSeen: false,
    error: null,
    start: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderAtCameraStep() {
  const utils = render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );
  // Step 0 -> step 1 ("Проверка камеры").
  fireEvent.click(screen.getByText("Начать"));
  return utils;
}

describe("OnboardingPage CameraStep camera start", () => {
  it("mounts the <video> element BEFORE the camera is started (not gated on cam.started)", () => {
    const cam = stubCam({ started: false });
    useCameraCheckMock.mockReturnValue(cam);

    const { container } = renderAtCameraStep();

    // Precondition useCameraCheck.start() needs: <video> already in the DOM
    // (cam.videoRef.current non-null) BEFORE the user clicks "Включить
    // камеру" — otherwise camera.start() throws "video element not mounted"
    // on every attempt, exactly like the CubeRegisterWizard bug.
    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.getByText("Включить камеру")).toBeTruthy();
  });

  it("clicking the enable button calls start() while the video ref is already attached", () => {
    const cam = stubCam({ started: false });
    useCameraCheckMock.mockReturnValue(cam);

    renderAtCameraStep();

    expect(cam.videoRef.current).not.toBeNull();
    fireEvent.click(screen.getByText("Включить камеру"));
    expect(cam.start).toHaveBeenCalledTimes(1);
  });

  it("keeps the video mounted once started, showing the hands-search status", () => {
    const cam = stubCam({ started: true, handsSeen: false });
    useCameraCheckMock.mockReturnValue(cam);

    const { container } = renderAtCameraStep();

    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.getByText("Ищу руки в кадре…")).toBeTruthy();
  });
});
