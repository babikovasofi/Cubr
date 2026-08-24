// @vitest-environment jsdom
//
// Onboarding step 4 — the account handle (П10). Covers: the step renders and
// is honest about where the name becomes visible; it is skippable (empty
// submit advances without touching the API); a filled name is sent via PATCH
// /users/me; the name filter's and the handle-collision's real error text
// reach the person verbatim; skipping never breaks finishing onboarding.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CameraCheck } from "../../src/onboarding/useCameraCheck";
import { ApiError } from "../../src/api/client";
import { useAuthStore } from "../../src/store/authStore";

const { useCameraCheckMock, markOnboardedMock } = vi.hoisted(() => ({
  useCameraCheckMock: vi.fn(),
  markOnboardedMock: vi.fn(),
}));
vi.mock("../../src/onboarding/useCameraCheck", async () => {
  const actual = await vi.importActual<typeof import("../../src/onboarding/useCameraCheck")>(
    "../../src/onboarding/useCameraCheck",
  );
  return { ...actual, useCameraCheck: useCameraCheckMock };
});

// `markOnboarded()` writes to `localStorage`, which is unreliably available in
// this environment (see tests/setup.ts's docblock on the same quirk) — spying
// on the call itself is what actually proves "finish() ran", independent of
// that flakiness.
vi.mock("../../src/auth/onboarding", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth/onboarding")>(
    "../../src/auth/onboarding",
  );
  return { ...actual, markOnboarded: markOnboardedMock };
});

// The cube-registration wizard owns its own camera pipeline — irrelevant to the
// handle step. Stub it down to a single button that stands in for
// "cancel/skip the cube step", the same way its own onCancel prop is wired.
vi.mock("../../src/cubes/CubeRegisterWizard", () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <button type="button" onClick={onCancel}>
      stub: leave cube step
    </button>
  ),
}));

import OnboardingPage from "../../src/pages/OnboardingPage";

function stubCam(overrides: Partial<CameraCheck> = {}): CameraCheck {
  return {
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    started: true,
    starting: false,
    handsSeen: true,
    error: null,
    start: vi.fn(async () => {}),
    ...overrides,
  };
}

async function renderAtHandleStep() {
  useCameraCheckMock.mockReturnValue(stubCam());
  const utils = render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Начать")); // step 0 -> 1
  fireEvent.click(screen.getByRole("button", { name: "Далее" })); // step 1 -> 2 (hands already seen)
  fireEvent.click(screen.getByText("stub: leave cube step")); // step 2 -> 3
  return utils;
}

const updateMeMock = vi.fn();

beforeEach(() => {
  updateMeMock.mockReset();
  markOnboardedMock.mockReset();
  useAuthStore.setState({ updateMe: updateMeMock });
});

afterEach(cleanup);

describe("OnboardingPage HandleStep", () => {
  it("renders the step with an honest caption about where the name is shown", async () => {
    await renderAtHandleStep();

    expect(screen.getByLabelText("Ник")).toBeTruthy();
    expect(
      screen.getByText(/в шапке профиля, списке друзей и таблицах турнира и скрамбла дня/),
    ).toBeTruthy();
    // Explicitly says it can be set/changed later — the pitch that makes
    // skipping not feel like a loss.
    expect(screen.getByText(/Можно задать или изменить его позже в профиле/)).toBeTruthy();
  });

  it("is skippable: submitting an empty field finishes onboarding without calling the API", async () => {
    await renderAtHandleStep();

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));

    await waitFor(() => {
      expect(markOnboardedMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMeMock).not.toHaveBeenCalled();
  });

  it("sends a typed name to PATCH /users/me and finishes on success", async () => {
    updateMeMock.mockResolvedValue({});
    await renderAtHandleStep();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "SpeedCuber" } });
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));

    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith({ handle: "SpeedCuber" });
    });
    await waitFor(() => {
      expect(markOnboardedMock).toHaveBeenCalledTimes(1);
    });
  });

  it("если набрать «@ник» вручную, ведущая собака молча срезается", async () => {
    updateMeMock.mockResolvedValue({});
    await renderAtHandleStep();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "@SpeedCuber" } });
    expect(input.value).toBe("SpeedCuber");

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));

    await waitFor(() => {
      expect(updateMeMock).toHaveBeenCalledWith({ handle: "SpeedCuber" });
    });
  });

  it("shows the name filter's real rejection text and stays on the step", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "NAME_NOT_ALLOWED", "Такое имя не подходит. Выбери другое."),
    );
    await renderAtHandleStep();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "мудак" } });
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));

    await waitFor(() => {
      expect(screen.getByText("Такое имя не подходит. Выбери другое.")).toBeTruthy();
    });
    expect(markOnboardedMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Ник")).toBeTruthy(); // still on this step
  });

  it("shows a clear 'handle taken' message on collision and stays on the step", async () => {
    updateMeMock.mockRejectedValue(
      new ApiError(400, "HANDLE_TAKEN", "Это имя уже занято другим пользователем."),
    );
    await renderAtHandleStep();

    const input = screen.getByLabelText("Ник") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "SpeedCuber" } });
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));

    await waitFor(() => {
      expect(screen.getByText("Это имя уже занято другим пользователем.")).toBeTruthy();
    });
    expect(markOnboardedMock).not.toHaveBeenCalled();
  });

  it("can go back to the cube step", async () => {
    await renderAtHandleStep();
    fireEvent.click(screen.getByText("← Назад"));
    expect(screen.getByText("stub: leave cube step")).toBeTruthy();
  });
});
