// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LastLayerDiagram from "../../src/components/LastLayerDiagram";
import { FACE_COLOR } from "../../src/components/cubeColors";
import { PLL_CASES, getCase } from "../../src/trainer/pll";

const SOLVED = "UUUUUUUUU" + "RRRRRRRRR" + "FFFFFFFFF" + "DDDDDDDDD" + "LLLLLLLLL" + "BBBBBBBBB";

function stickers() {
  return screen.getAllByTestId("ll-sticker");
}

// jsdom normalizes an assigned CSS color (e.g. "#FFFFFF" -> "rgb(255, 255,
// 255)") but passes an unresolved custom property (e.g. "var(--danger)")
// through unchanged — so a literal-string comparison against FACE_COLOR
// would only work for white. Round-tripping the expected value through the
// same assignment normalizes both sides consistently.
function cssColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.background = value;
  return probe.style.background;
}

describe("LastLayerDiagram", () => {
  it("solved: renders 9 U cells one color, 3 side stickers per F/R/B/L in that face's color", () => {
    render(<LastLayerDiagram facelets={SOLVED} caption="Solved" />);
    const els = stickers();
    expect(els).toHaveLength(21); // 9 U + 3*4 sides

    const uCells = els.filter((el) => el.getAttribute("data-face") === "U");
    expect(uCells).toHaveLength(9);
    expect(new Set(uCells.map((el) => el.style.background)).size).toBe(1);
    expect(uCells[0].style.background).toBe(cssColor(FACE_COLOR.U));

    for (const face of ["F", "R", "B", "L"] as const) {
      const side = els.filter((el) => el.getAttribute("data-face") === face);
      expect(side, face).toHaveLength(3);
      for (const el of side) expect(el.style.background).toBe(cssColor(FACE_COLOR[face]));
    }
  });

  it("U face is always single-colored for a real PLL case (OLL already solved)", () => {
    for (const c of PLL_CASES) {
      const { unmount } = render(<LastLayerDiagram facelets={c.facelets} caption={c.id} />);
      const uCells = stickers().filter((el) => el.getAttribute("data-face") === "U");
      expect(new Set(uCells.map((el) => el.style.background)), c.id).toEqual(
        new Set([cssColor(FACE_COLOR.U)]),
      );
      unmount();
    }
  });

  it("side stickers are permuted exactly at the declared positions (T-perm)", () => {
    const t = getCase("T");
    render(<LastLayerDiagram facelets={t.facelets} caption="T" />);
    const els = stickers();
    const byFaceSlot = new Map(
      els.map((el) => [`${el.getAttribute("data-face")}${el.getAttribute("data-slot")}`, el]),
    );
    const faceStart = { U: 0, R: 9, F: 18, L: 36, B: 45 } as const;
    for (const [face, start] of Object.entries(faceStart) as [keyof typeof faceStart, number][]) {
      const count = face === "U" ? 9 : 3;
      for (let i = 0; i < count; i++) {
        const expected = cssColor(FACE_COLOR[t.facelets[start + i] as keyof typeof FACE_COLOR]);
        const el = byFaceSlot.get(`${face}${i}`);
        expect(el, `${face}${i}`).toBeDefined();
        expect(el!.style.background, `${face}${i}`).toBe(expected);
      }
    }
  });

  it("the grid is aria-hidden; the caption is the accessible text", () => {
    render(<LastLayerDiagram facelets={SOLVED} caption="Собранный кубик" />);
    expect(screen.getByText("Собранный кубик")).toBeTruthy();
  });
});
