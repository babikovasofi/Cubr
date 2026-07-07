import { describe, it, expect } from "vitest";
import { parseMove, moveLabelRu } from "../../src/scramble/moveCopy";

const FACES = ["U", "D", "R", "L", "F", "B"];
const SUFFIXES = ["", "'", "2"] as const;

describe("moveCopy", () => {
  it("parses every face × suffix into non-empty Russian direction", () => {
    for (const f of FACES) {
      for (const s of SUFFIXES) {
        const info = parseMove(f + s);
        expect(info.face).toBe(f);
        expect(info.suffix).toBe(s);
        expect(info.faceRu.length).toBeGreaterThan(0);
        expect(info.directionRu.length).toBeGreaterThan(0);
      }
    }
  });

  it("distinguishes CW vs CCW (R vs R')", () => {
    expect(parseMove("R").directionRu).not.toBe(parseMove("R'").directionRu);
  });

  it("half turn (×2) is direction-agnostic", () => {
    expect(parseMove("U2").directionRu).toContain("пол-оборота");
    expect(parseMove("F2").directionRu).toContain("пол-оборота");
  });

  it("moveLabelRu is a capitalized one-liner", () => {
    const s = moveLabelRu("R");
    expect(s.startsWith("Правый слой")).toBe(true);
    expect(s.endsWith(".")).toBe(true);
  });
});
