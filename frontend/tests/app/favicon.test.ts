// Симметрия иконки.
//
// SVG когда-то писался руками, и числа разошлись с генератором: шаг ячеек 143
// при размере 119 давал отступ 38 слева и 7 справа. PNG считался скриптом и
// оставался ровным, поэтому расхождение было не видно нигде, кроме вкладки
// браузера — а она показывает именно SVG.
//
// Тест смотрит на файл, а не на скрипт: важно то, что уедет на прод.

import { describe, it, expect } from "vitest";

const SVG = import.meta.glob("../../public/favicon.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rects(svg: string): Rect[] {
  const out: Rect[] = [];
  for (const m of svg.matchAll(
    /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
  )) {
    out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  }
  return out;
}

describe("favicon.svg", () => {
  const svg = Object.values(SVG)[0];

  it("файл на месте и это корпус плюс девять наклеек", () => {
    expect(svg).toBeTruthy();
    expect(rects(svg)).toHaveLength(10);
  });

  it("сетка стоит по центру корпуса", () => {
    const [body, ...cells] = rects(svg);
    const left = Math.min(...cells.map((c) => c.x)) - body.x;
    const right = body.x + body.w - Math.max(...cells.map((c) => c.x + c.w));
    const top = Math.min(...cells.map((c) => c.y)) - body.y;
    const bottom = body.y + body.h - Math.max(...cells.map((c) => c.y + c.h));

    expect(right).toBeCloseTo(left, 1);
    expect(bottom).toBeCloseTo(top, 1);
    expect(left).toBeCloseTo(top, 1); // и поля одинаковы по обеим осям
  });

  it("шаг сетки равен ячейке плюс один и тот же шов", () => {
    const cells = rects(svg).slice(1);
    const xs = [...new Set(cells.map((c) => Math.round(c.x * 100) / 100))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    const gapA = xs[1] - xs[0];
    const gapB = xs[2] - xs[1];
    expect(gapB).toBeCloseTo(gapA, 1);
    // Шов положительный и заметный: слипшиеся наклейки в 16px читаются пятном.
    expect(gapA - cells[0].w).toBeGreaterThan(cells[0].w * 0.1);
  });

  it("корпус вписан в viewBox с одинаковым полем", () => {
    const [body] = rects(svg);
    expect(512 - (body.x + body.w)).toBeCloseTo(body.x, 1);
    expect(body.w).toBeCloseTo(body.h, 1);
  });

  it("правится только скриптом", () => {
    expect(svg).toContain("СГЕНЕРИРОВАНО scripts/make-icons.py");
  });
});
