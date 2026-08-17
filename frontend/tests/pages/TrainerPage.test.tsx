// @vitest-environment jsdom
//
// §П5 — practice writes zero rows anywhere. TrainerPage.test.tsx covers: no
// selection defaults to "all cases", the two buttons actually change state,
// selection/anyGrip round-trip through localStorage, a throwing localStorage
// doesn't crash the page, and — the one that matters most — zero network
// calls across every interaction.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TrainerPage from "../../src/pages/TrainerPage";
import { ALL_CASE_IDS } from "../../src/trainer/pll";

// Raw source text of every trainer file, for the static import check below —
// Vite-native (import.meta.glob), so it needs no Node fs/path types.
const TRAINER_SOURCES = import.meta.glob("../../src/trainer/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const TRAINER_PAGE_SOURCE = import.meta.glob("../../src/pages/TrainerPage.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  vi.stubGlobal("localStorage", storage);
  return data;
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrainerPage", () => {
  it("no selection (fresh localStorage) defaults to all 21 cases", () => {
    render(<TrainerPage />);
    for (const id of ALL_CASE_IDS) {
      const box = screen.getByRole("checkbox", { name: id }) as HTMLInputElement;
      expect(box.checked, id).toBe(true);
    }
  });

  it('"Следующий случай" changes the scramble string', () => {
    render(<TrainerPage />);
    const before = screen.getByLabelText("Скрамбл").textContent;
    // A handful of tries: with 21 cases x 4 AUF the same string can recur by
    // chance, but not every single time in 20 draws.
    let changed = false;
    for (let i = 0; i < 20 && !changed; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));
      changed = screen.getByLabelText("Скрамбл").textContent !== before;
    }
    expect(changed).toBe(true);
  });

  it('"Показать ответ" reveals name/algorithm/diagram, absent before the click', () => {
    render(<TrainerPage />);
    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeTruthy();
    // Algorithm text and diagram are not on the page yet.
    expect(screen.queryAllByTestId("ll-sticker")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Показать ответ" }));

    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeNull();
    expect(screen.getAllByTestId("ll-sticker").length).toBeGreaterThan(0);
  });

  it("a single-case selection shows the name immediately, no reveal needed", () => {
    render(<TrainerPage />);
    // Deselect all but one case (Ua).
    for (const id of ALL_CASE_IDS) {
      if (id === "Ua") continue;
      const box = screen.getByRole("checkbox", { name: id });
      fireEvent.click(box);
    }
    fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));

    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeNull();
    expect(screen.getAllByTestId("ll-sticker").length).toBeGreaterThan(0);
  });

  it("unchecking the last remaining case is a no-op", () => {
    render(<TrainerPage />);
    for (const id of ALL_CASE_IDS) {
      if (id === "Ua") continue;
      fireEvent.click(screen.getByRole("checkbox", { name: id }));
    }
    const last = screen.getByRole("checkbox", { name: "Ua" }) as HTMLInputElement;
    expect(last.checked).toBe(true);
    fireEvent.click(last);
    expect(last.checked).toBe(true); // still checked — can't reach empty selection
  });

  it("selection and any-grip round-trip through localStorage", () => {
    const data = stubStorage();
    render(<TrainerPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Ua" })); // deselect Ua
    expect(JSON.parse(data.get("cubr.trainer.pll.cases")!)).not.toContain("Ua");

    fireEvent.click(screen.getByRole("radio", { name: "Любой хват" }));
    expect(data.get("cubr.trainer.pll.anyGrip")).toBe("1");
  });

  it("a throwing localStorage does not crash the page", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
      removeItem: () => {
        throw new Error("boom");
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage);

    expect(() => render(<TrainerPage />)).not.toThrow();
    expect(screen.getByText("Тренажёр PLL")).toBeTruthy();
  });
});

describe("TrainerPage — §П5 zero network", () => {
  it("mounting and exercising every control makes 0 fetch calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch should never be called from TrainerPage");
    });

    render(<TrainerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать ответ" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "T" }));
    fireEvent.click(screen.getByRole("radio", { name: "Любой хват" }));
    fireEvent.click(screen.getByRole("button", { name: "Все 21" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("static check: no file under src/trainer/ or TrainerPage.tsx imports from src/api/", () => {
    const files = { ...TRAINER_SOURCES, ...TRAINER_PAGE_SOURCE };
    expect(Object.keys(files).length).toBeGreaterThan(0); // the glob actually matched something
    for (const [file, source] of Object.entries(files)) {
      expect(source, file).not.toMatch(/from ["'][./]*api\//);
    }
  });
});
