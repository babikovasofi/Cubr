import { describe, it, expect } from "vitest";
import { formatHandle, stripHandlePrefix } from "../../src/lib/handle";

describe("formatHandle", () => {
  it("добавляет ведущую собаку к голому нику", () => {
    expect(formatHandle("SpeedCuber")).toBe("@SpeedCuber");
  });
});

describe("stripHandlePrefix", () => {
  it("срезает ведущую собаку, если человек её набрал", () => {
    expect(stripHandlePrefix("@SpeedCuber")).toBe("SpeedCuber");
  });

  it("не трогает значение без собаки", () => {
    expect(stripHandlePrefix("SpeedCuber")).toBe("SpeedCuber");
  });

  it("срезает только ОДНУ ведущую собаку", () => {
    expect(stripHandlePrefix("@@weird")).toBe("@weird");
  });

  it("не трогает собаку не в начале строки", () => {
    expect(stripHandlePrefix("speed@cuber")).toBe("speed@cuber");
  });

  it("пустая строка остаётся пустой", () => {
    expect(stripHandlePrefix("")).toBe("");
  });
});
