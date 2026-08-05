// @vitest-environment jsdom
//
// Переключатель вместо системного <select> (просьба из живого теста: элементы
// должны быть в языке сайта). Под капотом — честная радиогруппа, иначе
// «красивый» переключатель теряет клавиатуру и скринридер.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SegmentedToggle from "../../src/components/SegmentedToggle";

const OPTIONS = [
  { value: "ru" as const, label: "RU" },
  { value: "en" as const, label: "EN" },
];

afterEach(cleanup);

describe("SegmentedToggle", () => {
  it("это радиогруппа, а не набор кнопок", () => {
    render(<SegmentedToggle value="ru" options={OPTIONS} onChange={() => {}} label="Язык" />);

    expect(screen.getByRole("radiogroup", { name: "Язык" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("активен ровно текущий вариант", () => {
    render(<SegmentedToggle value="en" options={OPTIONS} onChange={() => {}} label="Язык" />);

    expect((screen.getByRole("radio", { name: "RU" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "EN" }) as HTMLInputElement).checked).toBe(true);
  });

  it("выбор отдаёт значение наружу", () => {
    const onChange = vi.fn();
    render(<SegmentedToggle value="ru" options={OPTIONS} onChange={onChange} label="Язык" />);

    fireEvent.click(screen.getByRole("radio", { name: "EN" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});
