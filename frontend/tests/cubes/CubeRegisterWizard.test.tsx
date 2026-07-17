// @vitest-environment jsdom
//
// Regression for the "camera never starts" dead end in the add-cube wizard
// («Мои кубики» → CubeRegisterWizard, also reached from onboarding's cube
// step). Root cause: the <video> element (owned by CameraStage, bound via
// reg.videoRef) used to be rendered ONLY after reg.started flipped true —
// but useCubeRegister.start() requires reg.videoRef.current to already be a
// mounted DOM node before it calls camera.start(). So the very first click
// on "Включить камеру" always failed with "video element not mounted",
// surfaced as a permission-denied-looking error, and every retry hit the
// exact same wall (started never became true, so the video element never
// mounted, so start() never had a chance to succeed) — a dead end with a
// button that could never work.
//
// This test proves the fix structurally: CameraStage/<video> is mounted
// from the FIRST render, before the user ever clicks the enable button —
// matching how the (working) solo ritual mounts CameraStage up front.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CubeRegister } from "../../src/cubes/useCubeRegister";

const { useCubeRegisterMock } = vi.hoisted(() => ({ useCubeRegisterMock: vi.fn() }));
vi.mock("../../src/cubes/useCubeRegister", async () => {
  const actual = await vi.importActual<typeof import("../../src/cubes/useCubeRegister")>(
    "../../src/cubes/useCubeRegister",
  );
  return { ...actual, useCubeRegister: useCubeRegisterMock };
});

vi.mock("../../src/store/cubesStore", () => ({
  useCubesStore: vi.fn(() => vi.fn()),
}));

import CubeRegisterWizard from "../../src/cubes/CubeRegisterWizard";

function stubReg(overrides: Partial<CubeRegister> = {}): CubeRegister {
  return {
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    started: false,
    error: null,
    calibrationStep: 0,
    calibrated: false,
    profile: null,
    start: vi.fn(async () => {}),
    capture: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe("CubeRegisterWizard camera start", () => {
  it("mounts the <video> element BEFORE the camera is started (not gated on reg.started)", () => {
    const reg = stubReg({ started: false });
    useCubeRegisterMock.mockReturnValue(reg);

    const { container } = render(
      <CubeRegisterWizard onDone={() => {}} onCancel={() => {}} />,
    );

    // This is the exact precondition useCubeRegister.start() needs: the
    // <video> node must already be in the DOM (so reg.videoRef.current is
    // non-null) BEFORE the user clicks "Включить камеру" — otherwise
    // camera.start() throws "video element not mounted" on every attempt.
    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.getByText("Включить камеру")).toBeTruthy();
  });

  it("clicking the enable button calls start() while the video ref is already attached", () => {
    const reg = stubReg({ started: false });
    useCubeRegisterMock.mockReturnValue(reg);

    render(<CubeRegisterWizard onDone={() => {}} onCancel={() => {}} />);

    expect(reg.videoRef.current).not.toBeNull();
    fireEvent.click(screen.getByText("Включить камеру"));
    expect(reg.start).toHaveBeenCalledTimes(1);
  });

  it("keeps the video mounted once started, showing the capture step", () => {
    const reg = stubReg({ started: true, calibrationStep: 2 });
    useCubeRegisterMock.mockReturnValue(reg);

    const { container } = render(
      <CubeRegisterWizard onDone={() => {}} onCancel={() => {}} />,
    );

    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.getByText("Снять грань 3/6")).toBeTruthy();
  });
});
