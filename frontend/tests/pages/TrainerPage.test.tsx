// @vitest-environment jsdom
//
// §П5 — practice writes zero rows anywhere. TrainerPage.test.tsx covers: no
// selection defaults to "everything" (PLL + OLL), the set toggle and the two
// draw buttons actually change state, selection/anyGrip round-trip through
// localStorage (new keys AND backward-compat with the pre-OLL PLL-only
// keys), a throwing localStorage doesn't crash the page, PLL vs OLL never
// get their diagrams swapped, and — the one that matters most — zero
// network calls across every interaction.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TrainerPage from "../../src/pages/TrainerPage";
import { ALL_CASE_IDS } from "../../src/trainer/pll";
import { ALL_OLL_CASE_IDS, OLL_CASES } from "../../src/trainer/oll";

const OLL_LABEL = new Map(OLL_CASES.map((c) => [c.id, `${c.number} · ${c.name}`]));

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
  it("no selection (fresh localStorage) defaults to both sets, all cases", () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "PLL (перестановка)" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "OLL (ориентация)" }).getAttribute("aria-pressed"),
    ).toBe("true");
    for (const id of ALL_CASE_IDS) {
      const box = screen.getByRole("checkbox", { name: id }) as HTMLInputElement;
      expect(box.checked, id).toBe(true);
    }
    // Spot-check a few OLL checkboxes rather than all 57 (labels are
    // "27 · Sune", not the bare id) -- full coverage lives in useTrainer's
    // own unit-level reasoning; this just proves OLL renders and is checked.
    expect((screen.getByRole("checkbox", { name: "27 · Sune" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole("checkbox", { name: "26 · Antisune" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('"Следующий случай" changes the scramble string', () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    const before = screen.getByLabelText("Скрамбл").textContent;
    let changed = false;
    for (let i = 0; i < 30 && !changed; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));
      changed = screen.getByLabelText("Скрамбл").textContent !== before;
    }
    expect(changed).toBe(true);
  });

  it('"Показать ответ" reveals name/algorithm/diagram, absent before the click', () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeTruthy();
    expect(screen.queryAllByTestId("ll-sticker")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Показать ответ" }));

    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeNull();
    expect(screen.getAllByTestId("ll-sticker").length).toBeGreaterThan(0);
  });

  it("a single-case PLL selection shows the name immediately, no reveal needed, and renders the PLL (not OLL) diagram", () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    // Turn OLL off, then deselect every PLL case but Ua.
    fireEvent.click(screen.getByRole("button", { name: "OLL (ориентация)" }));
    for (const id of ALL_CASE_IDS) {
      if (id === "Ua") continue;
      fireEvent.click(screen.getByRole("checkbox", { name: id }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));

    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeNull();
    const stickers = screen.getAllByTestId("ll-sticker");
    expect(stickers.length).toBeGreaterThan(0);
    // PLL's diagram uses real per-face colors -- more than 2 distinct
    // background colors appear (OLL's diagram is strictly binary).
    const colors = new Set(stickers.map((el) => (el as HTMLElement).style.background));
    expect(colors.size).toBeGreaterThan(2);
  });

  it("a single-case OLL selection shows the name immediately and renders the binary OLL diagram", () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "PLL (перестановка)" })); // turn PLL off
    for (const id of ALL_OLL_CASE_IDS) {
      if (id === "OLL27") continue;
      fireEvent.click(screen.getByRole("checkbox", { name: OLL_LABEL.get(id)! }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));

    expect(screen.queryByRole("button", { name: "Показать ответ" })).toBeNull();
    expect(screen.getAllByText("27 · Sune").length).toBeGreaterThan(0);
    const stickers = screen.getAllByTestId("ll-sticker");
    expect(stickers.length).toBeGreaterThan(0);
    // OLL's diagram is strictly binary: at most 2 distinct background colors.
    const colors = new Set(stickers.map((el) => (el as HTMLElement).style.background));
    expect(colors.size).toBeLessThanOrEqual(2);
  });

  it("unchecking the last remaining case is a no-op", () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "OLL (ориентация)" })); // turn OLL off
    for (const id of ALL_CASE_IDS) {
      if (id === "Ua") continue;
      fireEvent.click(screen.getByRole("checkbox", { name: id }));
    }
    const last = screen.getByRole("checkbox", { name: "Ua" }) as HTMLInputElement;
    expect(last.checked).toBe(true);
    fireEvent.click(last);
    expect(last.checked).toBe(true); // still checked — can't reach empty selection
  });

  it("turning off the last remaining set is a no-op", () => {
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "OLL (ориентация)" })); // pll only now
    const pllToggle = screen.getByRole("button", { name: "PLL (перестановка)" });
    expect(pllToggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pllToggle); // try to turn off the only remaining set
    expect(pllToggle.getAttribute("aria-pressed")).toBe("true"); // still on
  });

  it("selection and any-grip round-trip through localStorage (new keys)", () => {
    const data = stubStorage();
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Ua" })); // deselect Ua
    expect(JSON.parse(data.get("cubr.trainer.cases")!)).not.toContain("Ua");
    expect(JSON.parse(data.get("cubr.trainer.sets")!)).toEqual(["pll", "oll"]);

    fireEvent.click(screen.getByRole("radio", { name: "Любой хват" }));
    expect(data.get("cubr.trainer.anyGrip")).toBe("1");
  });

  it("legacy PLL-only storage (pre-OLL) is honored: only PLL shown, its selection preserved", () => {
    stubStorage({
      "cubr.trainer.pll.cases": JSON.stringify(["Ua", "T"]),
      "cubr.trainer.pll.anyGrip": "1",
    });
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "PLL (перестановка)" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "OLL (ориентация)" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.queryByRole("checkbox", { name: "27 · Sune" })).toBeNull(); // OLL section not rendered

    const ua = screen.getByRole("checkbox", { name: "Ua" }) as HTMLInputElement;
    const t = screen.getByRole("checkbox", { name: "T" }) as HTMLInputElement;
    const ub = screen.getByRole("checkbox", { name: "Ub" }) as HTMLInputElement;
    expect(ua.checked).toBe(true);
    expect(t.checked).toBe(true);
    expect(ub.checked).toBe(false);

    expect((screen.getByRole("radio", { name: "Любой хват" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("a corrupt legacy PLL selection falls back to all 21 PLL cases, PLL-only", () => {
    stubStorage({ "cubr.trainer.pll.cases": "{not json" });
    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "OLL (ориентация)" }).getAttribute("aria-pressed"),
    ).toBe("false");
    for (const id of ALL_CASE_IDS) {
      expect((screen.getByRole("checkbox", { name: id }) as HTMLInputElement).checked, id).toBe(
        true,
      );
    }
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

    expect(() =>
      render(
        <MemoryRouter>
          <TrainerPage />
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(screen.getByText("Тренажёр")).toBeTruthy();
  });
});

describe("TrainerPage — §П5 zero network", () => {
  it("mounting and exercising every control makes 0 fetch calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch should never be called from TrainerPage");
    });

    render(
      <MemoryRouter>
        <TrainerPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Следующий случай" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать ответ" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "T" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "27 · Sune" }));
    fireEvent.click(screen.getByRole("radio", { name: "Любой хват" }));
    fireEvent.click(screen.getByRole("button", { name: "OLL (ориентация)" }));
    fireEvent.click(screen.getByRole("button", { name: "OLL (ориентация)" }));
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
