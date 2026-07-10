import { describe, it, expect } from "vitest";
import {
  rgb2lab,
  lab2rgb,
  deltaE76,
  deltaE2000,
  medianOfCentralRegion,
  calibrate,
  classifyFace,
  assignQuota,
  COLOR_NAMES,
  type RGB,
  type Lab,
  type Refs,
} from "../../src/vision/colors";

describe("rgb2lab", () => {
  it("maps black to L=0", () => {
    const [L, a, b] = rgb2lab([0, 0, 0]);
    expect(L).toBeCloseTo(0, 3);
    expect(a).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("maps white to L=100, near-zero chroma", () => {
    const [L, a, b] = rgb2lab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });

  it("known value: pure red sRGB -> Lab ~ (53.24, 80.09, 67.20)", () => {
    const [L, a, b] = rgb2lab([255, 0, 0]);
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });
});

describe("lab2rgb (inverse of rgb2lab, for swatch rendering)", () => {
  it.each([
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [34, 139, 34],
    [70, 130, 180],
  ])("round-trips sRGB [%i,%i,%i] within 1 level", (r, g, b) => {
    const [rr, gg, bb] = lab2rgb(rgb2lab([r, g, b]));
    expect(Math.abs(rr - r)).toBeLessThanOrEqual(1);
    expect(Math.abs(gg - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(bb - b)).toBeLessThanOrEqual(1);
  });

  it("clamps out-of-gamut Lab into 0..255", () => {
    for (const c of lab2rgb([50, 120, -120])) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});

describe("deltaE", () => {
  it("CIE76 is zero on identity", () => {
    const lab = rgb2lab([120, 60, 200]);
    expect(deltaE76(lab, lab)).toBeCloseTo(0, 6);
  });

  it("CIEDE2000 is zero on identity", () => {
    const lab = rgb2lab([10, 200, 90]);
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 6);
  });

  it("CIEDE2000 is symmetric", () => {
    const a = rgb2lab([200, 30, 30]);
    const b = rgb2lab([220, 90, 10]);
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 6);
  });

  it("CIEDE2000 matches Sharma reference pair 1 (dE ~ 2.0425)", () => {
    // Sharma test data: Lab1=(50,2.6772,-79.7751), Lab2=(50,0,-82.7485)
    const l1: Lab = [50, 2.6772, -79.7751];
    const l2: Lab = [50, 0, -82.7485];
    expect(deltaE2000(l1, l2)).toBeCloseTo(2.0425, 3);
  });

  it("CIEDE2000 matches Sharma reference pair (dE = 1.0000, by construction)", () => {
    // Sharma dataset: this pair is constructed so dE00 == exactly 1.0000.
    const l1: Lab = [50, 2.5, 0];
    const l2: Lab = [50, 3.1736, 0.5854];
    expect(deltaE2000(l1, l2)).toBeCloseTo(1.0, 3);
  });
});

describe("medianOfCentralRegion", () => {
  it("ignores an outlier border ring, returns the central color", () => {
    // 4x4 block: fill with mid-gray, ring with white; central 50% -> gray.
    const w = 4;
    const h = 4;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const v = border ? 255 : 128;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    const [r, g, b] = medianOfCentralRegion(px, w, h, 0.5);
    expect([r, g, b]).toEqual([128, 128, 128]);
  });
});

// ---------------------------------------------------------------------------
// Quota 9x6: synthetic 54 Lab stickers with an ambiguous red/orange pair.
// ---------------------------------------------------------------------------

// Fabricate 6 well-separated reference RGBs (real cube-ish) plus two that are
// close (the R/orange trap). We map COLOR_NAMES to these.
const baseRGB: Record<string, RGB> = {
  U: [245, 245, 245], // white
  R: [200, 40, 40], // red
  F: [30, 130, 60], // green
  D: [235, 220, 40], // yellow
  L: [225, 110, 30], // orange (close to red)
  B: [30, 70, 200], // blue
};

function makeRefs(): Refs {
  const m = {} as Record<(typeof COLOR_NAMES)[number], RGB>;
  for (const n of COLOR_NAMES) m[n] = baseRGB[n];
  return calibrate(m);
}

function jitter(rgb: RGB, d: number): RGB {
  return [
    clamp(rgb[0] + rand(d)),
    clamp(rgb[1] + rand(d)),
    clamp(rgb[2] + rand(d)),
  ];
}
function rand(d: number): number {
  return Math.round((Math.random() * 2 - 1) * d);
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function buildDeck(): { labs: Lab[]; centerIdx: number[]; truth: string[] } {
  // 9 stickers per color, face-major so centers land at 4,13,22,31,40,49.
  const labs: Lab[] = [];
  const truth: string[] = [];
  const centerIdx: number[] = [];
  COLOR_NAMES.forEach((name, faceIdx) => {
    for (let cell = 0; cell < 9; cell++) {
      const globalIdx = faceIdx * 9 + cell;
      if (cell === 4) centerIdx.push(globalIdx);
      // Make several R and L (orange) stickers noisy/ambiguous.
      const noise = name === "R" || name === "L" ? 45 : 12;
      labs.push(rgb2lab(jitter(baseRGB[name], noise)));
      truth.push(name);
    }
  });
  return { labs, centerIdx, truth };
}

describe("assignQuota 9x6", () => {
  it("produces exactly 9 of each color and is balanced", () => {
    const refs = makeRefs();
    const { labs, centerIdx } = buildDeck();
    const res = assignQuota(labs, refs, centerIdx);
    for (const n of COLOR_NAMES) expect(res.counts[n]).toBe(9);
    expect(res.balanced).toBe(true);
  });

  it("pins centers to their own face color", () => {
    const refs = makeRefs();
    const { labs, centerIdx } = buildDeck();
    const res = assignQuota(labs, refs, centerIdx);
    COLOR_NAMES.forEach((name, k) => {
      expect(res.assignment[centerIdx[k]]).toBe(name);
    });
  });

  it("quota fixes red/orange better than naive argmin on an over-assigned deck", () => {
    const refs = makeRefs();
    // Deterministic deck: 9 clean of each, but 3 orange stickers pulled toward red.
    const labs: Lab[] = [];
    const truth: string[] = [];
    const centerIdx: number[] = [];
    COLOR_NAMES.forEach((name, faceIdx) => {
      for (let cell = 0; cell < 9; cell++) {
        const gi = faceIdx * 9 + cell;
        if (cell === 4) centerIdx.push(gi);
        let rgb = baseRGB[name];
        // Corrupt 3 orange (L) stickers toward red so naive argmin misfiles them.
        if (name === "L" && cell !== 4 && cell < 4) {
          rgb = [210, 70, 35]; // between orange and red
        }
        labs.push(rgb2lab(rgb));
        truth.push(name);
      }
    });

    // Naive argmin: expect it to over-assign R (some L->R), leaving R>9 desire.
    const naive = classifyFace(labs, refs);
    const naiveR = naive.filter((c) => c === "R").length;

    // Quota-constrained: must be exactly 9 R and 9 L.
    const res = assignQuota(labs, refs, centerIdx);
    expect(res.counts.R).toBe(9);
    expect(res.counts.L).toBe(9);
    // Naive should have MORE than 9 reds (the failure quota fixes).
    expect(naiveR).toBeGreaterThan(9);
  });
});
