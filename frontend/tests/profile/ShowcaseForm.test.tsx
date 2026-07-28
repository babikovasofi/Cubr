// @vitest-environment jsdom
//
// Витрина профиля (V3). Проверяем: год валидируется на клиенте теми же
// границами, что на сервере; пустые поля уходят как null (очистка легальна);
// подпись не врёт про публичность (публичных профилей нет).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import ShowcaseForm, {
  yearError,
  experienceLabel,
  MIN_CUBING_YEAR,
} from "../../src/profile/ShowcaseForm";

const onSave = vi.fn();

beforeEach(() => onSave.mockReset());
afterEach(cleanup);

describe("yearError", () => {
  it("пустой год допустим — поле необязательное", () => {
    expect(yearError("", 2026)).toBeNull();
  });

  it("до изобретения кубика — ошибка", () => {
    expect(yearError("1900", 2026)).toContain(String(MIN_CUBING_YEAR));
  });

  it("будущее — ошибка", () => {
    expect(yearError("2027", 2026)).toContain("будущем");
  });

  it("нормальный год проходит", () => {
    expect(yearError("2019", 2026)).toBeNull();
  });
});

describe("experienceLabel", () => {
  it.each([
    [2026, 2026, "первый год"],
    [2025, 2026, "1 год"],
    [2023, 2026, "3 года"],
    [2019, 2026, "7 лет"],
  ])("%i → %s", (year, now, expected) => {
    expect(experienceLabel(year, now)).toContain(expected);
  });
});

describe("ShowcaseForm", () => {
  it("не обещает публичность, пока витрина пуста", () => {
    render(<ShowcaseForm initialMethod={null} initialYear={null} onSave={onSave} />);
    expect(screen.getByText(/публичных профилей в Cubr нет/)).toBeTruthy();
  });

  it("сохраняет метод и год", async () => {
    onSave.mockResolvedValue(undefined);
    render(<ShowcaseForm initialMethod={null} initialYear={null} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Метод сборки"), { target: { value: "roux" } });
    fireEvent.change(screen.getByLabelText("Собираю с года"), { target: { value: "2019" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить витрину" }));
    });

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ method: "roux", cubing_since_year: 2019 }),
    );
    expect(screen.getByText("Сохранено")).toBeTruthy();
  });

  it("пустые поля уходят как null — очистка витрины легальна", async () => {
    onSave.mockResolvedValue(undefined);
    render(<ShowcaseForm initialMethod="cfop" initialYear={2020} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Метод сборки"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Собираю с года"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить витрину" }));
    });

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ method: null, cubing_since_year: null }),
    );
  });

  it("кривой год не уходит на сервер вовсе", async () => {
    render(<ShowcaseForm initialMethod={null} initialYear={null} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Собираю с года"), { target: { value: "1200" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить витрину" }));
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(String(MIN_CUBING_YEAR));
  });

  it("показывает метод и стаж, когда витрина заполнена", () => {
    render(<ShowcaseForm initialMethod="cfop" initialYear={2019} onSave={onSave} />);
    const currentYear = new Date().getFullYear();
    expect(
      screen.getByText(new RegExp(`CFOP.*${experienceLabel(2019, currentYear)}`)),
    ).toBeTruthy();
  });
});
