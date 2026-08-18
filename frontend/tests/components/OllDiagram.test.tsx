// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OllDiagram from "../../src/components/OllDiagram";
import { FACE_COLOR } from "../../src/components/cubeColors";
import { OLL_CASES, getOllCase } from "../../src/trainer/oll";

const SOLVED = "UUUUUUUUU" + "RRRRRRRRR" + "FFFFFFFFF" + "DDDDDDDDD" + "LLLLLLLLL" + "BBBBBBBBB";

function stickers() {
  return screen.getAllByTestId("ll-sticker");
}

// See LastLayerDiagram.test.tsx's own note: jsdom normalizes an assigned CSS
// color but passes an unresolved custom property through unchanged, so
// round-trip both sides through the same assignment before comparing.
function cssColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.background = value;
  return probe.style.background;
}

describe("OllDiagram", () => {
  it("solved: the 9 U cells are the ORIENTED color; the 12 side cells (real R/F/L/B, never 'U') are not", () => {
    render(<OllDiagram facelets={SOLVED} caption="Solved" />);
    const els = stickers();
    expect(els).toHaveLength(21);
    const uCells = els.filter((el) => el.getAttribute("data-face") === "U");
    expect(uCells).toHaveLength(9);
    for (const el of uCells) expect(el.style.background).toBe(cssColor(FACE_COLOR.U));

    const sideCells = els.filter((el) => el.getAttribute("data-face") !== "U");
    expect(sideCells).toHaveLength(12);
    for (const el of sideCells) expect(el.style.background).toBe(cssColor("var(--surface-2)"));
  });

  it("U face is NEVER single-colored for a real OLL case (that would mean already-oriented)", () => {
    for (const c of OLL_CASES) {
      const { unmount } = render(<OllDiagram facelets={c.facelets} caption={c.id} />);
      const uCells = stickers().filter((el) => el.getAttribute("data-face") === "U");
      const colors = new Set(uCells.map((el) => el.style.background));
      // At least one U cell is NOT the oriented color -- some corner/edge is
      // twisted/flipped, by definition of a non-solved OLL case.
      expect(colors.has(cssColor("var(--surface-2)")), c.id).toBe(true);
      unmount();
    }
  });

  it("every sticker is one of exactly two colors -- binary, never a 3rd/4th/5th/6th real face color", () => {
    const sune = getOllCase("OLL27");
    render(<OllDiagram facelets={sune.facelets} caption="Sune" />);
    const colors = new Set(stickers().map((el) => el.style.background));
    expect(colors.size).toBeLessThanOrEqual(2);
    for (const c of colors) {
      expect([cssColor(FACE_COLOR.U), cssColor("var(--surface-2)")]).toContain(c);
    }
  });

  it("oriented stickers exactly match where the facelet string reads 'U' (Sune's declared corner twists)", () => {
    const sune = getOllCase("OLL27");
    render(<OllDiagram facelets={sune.facelets} caption="Sune" />);
    const els = stickers();
    const faceStart = { U: 0, R: 9, F: 18, L: 36, B: 45 } as const;
    for (const [face, start] of Object.entries(faceStart) as [keyof typeof faceStart, number][]) {
      const count = face === "U" ? 9 : 3;
      for (let i = 0; i < count; i++) {
        const el = els.find(
          (e) => e.getAttribute("data-face") === face && e.getAttribute("data-slot") === String(i),
        );
        expect(el, `${face}${i}`).toBeDefined();
        const expectOriented = sune.facelets[start + i] === "U";
        expect(el!.style.background, `${face}${i}`).toBe(
          expectOriented ? cssColor(FACE_COLOR.U) : cssColor("var(--surface-2)"),
        );
      }
    }
  });

  it("the grid is aria-hidden; the caption is the accessible text", () => {
    render(<OllDiagram facelets={SOLVED} caption="Собранный кубик" />);
    expect(screen.getByText("Собранный кубик")).toBeTruthy();
  });
});
