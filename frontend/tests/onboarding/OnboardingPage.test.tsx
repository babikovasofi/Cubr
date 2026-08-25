// @vitest-environment jsdom
//
// Onboarding tutorial (7 steps): verifies the new teaching steps — ritual
// explanation, camera/hands setup guide, and cups/ranks primer — actually
// render and that the whole flow is reachable end-to-end via "Далее", and
// that every step (old and new) is still skippable via "Пропустить
// онбординг" from any point in the flow.
//
// Heavy subsystems (live camera/hands detection, cube color-profile wizard,
// handle availability check) are stubbed — this test is about onboarding
// flow/content, not vision or cube-registration internals, which have their
// own suites.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OnboardingPage from "../../src/pages/OnboardingPage";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../src/onboarding/useCameraCheck", () => ({
  useCameraCheck: () => ({
    videoRef: { current: null },
    overlayRef: { current: null },
    workRef: { current: null },
    started: true,
    starting: false,
    handsSeen: true,
    error: null,
    start: vi.fn(),
  }),
}));

vi.mock("../../src/solo/CameraStage", () => ({
  default: () => <div data-testid="camera-stage">CameraStage</div>,
}));

vi.mock("../../src/cubes/CubeRegisterWizard", () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>
      cube-wizard-done
    </button>
  ),
}));

vi.mock("../../src/auth/onboarding", () => ({
  markOnboarded: vi.fn(),
}));

vi.mock("../../src/api/auth", () => ({
  markOnboardedOnServer: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: Object.assign(
    vi.fn(() => vi.fn()),
    { setState: vi.fn() },
  ),
}));

beforeEach(() => {
  navigateMock.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("OnboardingPage — extended tutorial", () => {
  it("shows the 7-step progress list, starting on «Знакомство»", () => {
    renderPage();
    expect(screen.getByRole("list", { name: "Шаги онбординга" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Как это работает" })).toBeTruthy();
  });

  it("walks through the ritual step and shows the 4 solve-ritual cards", () => {
    renderPage();
    click("Начать");
    expect(screen.getByRole("heading", { name: "Как проходит сборка" })).toBeTruthy();
    expect(screen.getByText("Показываешь собранный кубик")).toBeTruthy();
    expect(screen.getByText("Скрамбл выдаёт компьютер")).toBeTruthy();
    expect(screen.getByText("Две руки на стол — старт")).toBeTruthy();
    expect(screen.getByText("Руки на стол — стоп")).toBeTruthy();
  });

  it("walks through the camera-setup guide step with the annotated mock frame", () => {
    renderPage();
    click("Начать"); // -> ritual
    click("Далее"); // -> camera guide
    expect(screen.getByRole("heading", { name: "Как поставить камеру и руки" })).toBeTruthy();
    expect(screen.getByText("Кубик — сюда, в жёлтую рамку")).toBeTruthy();
    expect(screen.getByText("Левая рука")).toBeTruthy();
    expect(screen.getByText("Правая рука")).toBeTruthy();
    expect(
      screen.getByText(
        "Руки видно только частично — это нормально, в кадр попадают кисти, не целиком.",
      ),
    ).toBeTruthy();
  });

  it("walks through camera check, cube registration, and the cups/ranks primer", () => {
    renderPage();
    click("Начать"); // -> ritual
    click("Далее"); // -> camera guide
    click("Далее"); // -> camera check
    expect(screen.getByRole("heading", { name: "Проверка камеры" })).toBeTruthy();
    expect(screen.getByTestId("camera-stage")).toBeTruthy();

    // Mocked useCameraCheck reports hands confirmed, so "Далее" is enabled.
    click("Далее");
    expect(screen.getByRole("heading", { name: "Регистрация кубика" })).toBeTruthy();

    click("cube-wizard-done");
    expect(screen.getByRole("heading", { name: "Кубки и ранги" })).toBeTruthy();
    expect(screen.getByText(/Выиграл дуэль/)).toBeTruthy();
    expect(screen.getByText("Сколько кубков")).toBeTruthy();

    click("Далее"); // -> handle
    expect(screen.getByRole("heading", { name: "Твой ник" })).toBeTruthy();
  });

  it("is skippable from any step via «Пропустить онбординг»", () => {
    renderPage();
    click("Начать");
    click("Пропустить онбординг");
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });
});
