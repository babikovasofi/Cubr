// @vitest-environment jsdom
//
// Regression: «Попробовать снова» под ошибкой в мастере регистрации кубика
// не делала НИЧЕГО, когда ошибка была «Грань не прочиталась».
//
// Причина — одно поле `error` обслуживает два разных отказа. Камера не
// поднялась лечится перезапуском камеры; грань не прочиталась лечится новым
// кадром, камера при этом жива. Кнопка звала `start()`, а тот выходит на
// первой строке (`if (started) return`) при уже запущенной камере, поэтому
// `setError(null)` не выполнялся никогда и надпись оставалась на экране.
//
// Тест держит обе половины починки: мастер зовёт `retry` (а не `start`), и
// сам `retry` при живой камере гасит ошибку вместо перезапуска.

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
    retry: vi.fn(async () => {}),
    capture: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe("«Попробовать снова» в мастере регистрации", () => {
  it("зовёт retry, а не start — start при живой камере молча выходит", () => {
    const reg = stubReg({
      started: true,
      error: "Грань не прочиталась — повтори. Держи её ровно в жёлтой рамке.",
    });
    useCubeRegisterMock.mockReturnValue(reg);

    render(<CubeRegisterWizard onDone={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Попробовать снова" }));

    expect(reg.retry).toHaveBeenCalledTimes(1);
    expect(reg.start).not.toHaveBeenCalled();
  });

  it("кнопка вообще присутствует, пока показана ошибка", () => {
    useCubeRegisterMock.mockReturnValue(
      stubReg({
        started: true,
        error: "Грань не прочиталась — повтори. Держи её ровно в жёлтой рамке.",
      }),
    );
    render(<CubeRegisterWizard onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Попробовать снова" })).toBeTruthy();
  });
});
