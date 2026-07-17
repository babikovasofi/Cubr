import { describe, it, expect } from "vitest";
import {
  rgb2lab,
  lab2rgb,
  deltaE76,
  deltaE2000,
  deltaE,
  medianOfCentralRegion,
  calibrate,
  classifyFace,
  assignQuota,
  applyLightGain,
  applyVonKries,
  vonKriesGain,
  COLOR_NAMES,
  type RGB,
  type Lab,
  type Refs,
} from "../../src/vision/colors";
import {
  quickAdjust,
  observedFaceStats,
  minPairwiseRefDE,
} from "../../src/vision/quickAdjust";
import { config } from "../../src/vision/config";

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

// ---------------------------------------------------------------------------
// Quick-adjust: one-white-face session white-balance (skeptic HIGH#1/#2/#3).
// ---------------------------------------------------------------------------

// A tight 9-sticker face from one RGB (small jitter keeps the cluster nonzero
// but well under QUICK_ADJUST_CLUSTER_DE).
function tightFace(rgb: RGB): RGB[] {
  return Array.from({ length: 9 }, (_, i) => {
    const d = (i % 3) - 1; // -1,0,1
    return [clamp(rgb[0] + d), clamp(rgb[1] + d), clamp(rgb[2] + d)];
  });
}

// A warm illuminant change: per-channel linear-sRGB gain (R up, B down). Kept
// under the white's headroom (245/255 ≈ 0.912 linear) so the observed white does
// NOT clip at 255 — a clipped white would under-report the true gain.
const LIGHT_B: [number, number, number] = [1.06, 0.9, 0.74];

describe("vonKriesGain + applyVonKries (multiplicative, linear-sRGB)", () => {
  it("recovers the illuminant gain from the observed white", () => {
    const refs = makeRefs();
    const observedWhite = applyLightGain(baseRGB.U, LIGHT_B);
    const g = vonKriesGain(observedWhite, refs.U);
    expect(g[0]).toBeGreaterThan(g[2]); // warm shift → red gain > blue gain
    expect(g[0]).toBeCloseTo(LIGHT_B[0], 1);
    expect(g[2]).toBeCloseTo(LIGHT_B[2], 1);
  });
});

describe("quickAdjust — von-Kries over one white face", () => {
  it("ok: applies the gain to ALL SIX refs, predicting each colour under the new light", () => {
    const refs = makeRefs();
    const observedWhite = applyLightGain(baseRGB.U, LIGHT_B);
    const r = quickAdjust(refs, tightFace(observedWhite));
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.matchedColor).toBe("U");

    // Every ref moved (a rigid no-op would leave them identical) AND lands on the
    // predicted appearance of that colour under LIGHT_B.
    for (const name of COLOR_NAMES) {
      expect(deltaE(r.refs[name], refs[name])).toBeGreaterThan(0.5);
      const predicted = rgb2lab(applyLightGain(baseRGB[name], LIGHT_B));
      expect(deltaE(r.refs[name], predicted)).toBeLessThan(2);
    }
  });

  it("wrong-face: a RED face is rejected (nearest ref isn't white) → caller recalibrates", () => {
    const refs = makeRefs();
    const r = quickAdjust(refs, tightFace(baseRGB.R));
    expect(r.kind).toBe("wrong-face");
    if (r.kind === "wrong-face") expect(r.nearestColor).not.toBe("U");
  });

  it("diverged (cluster): a white-ish but LOOSE read is rejected; refs left untouched", () => {
    const refs = makeRefs();
    // Half the stickers white, half strongly grey → large intra-cluster spread.
    const loose: RGB[] = [
      baseRGB.U, baseRGB.U, baseRGB.U, baseRGB.U, baseRGB.U,
      [150, 150, 150], [150, 150, 150], [150, 150, 150], [150, 150, 150],
    ];
    const r = quickAdjust(refs, loose);
    expect(r.kind).toBe("diverged");
    if (r.kind === "diverged") expect(r.reason).toBe("cluster");
  });

  it("diverged (margin): a near-neutral grey whose white match isn't confident enough", () => {
    // Refs where white and yellow are close in a/b so a greyish read has a weak
    // nearest-vs-second-best margin. Use a config with a big margin requirement.
    const refs = makeRefs();
    const cfg = { ...config, QUICK_ADJUST_MARGIN_DE: 200, QUICK_ADJUST_CLUSTER_DE: 100 };
    const r = quickAdjust(refs, tightFace(baseRGB.U), cfg);
    expect(r.kind).toBe("diverged");
    if (r.kind === "diverged") expect(r.reason).toBe("margin");
  });
});

describe("observedFaceStats", () => {
  it("reports a tight cluster and a confident white match on a clean white face", () => {
    const refs = makeRefs();
    const stats = observedFaceStats(tightFace(baseRGB.U).map(rgb2lab), refs);
    expect(stats.nearestColor).toBe("U");
    expect(stats.clusterSpread).toBeLessThan(config.QUICK_ADJUST_CLUSTER_DE);
    expect(stats.secondBestDE - stats.nearestDE).toBeGreaterThan(config.QUICK_ADJUST_MARGIN_DE);
  });

  it("reports a loose cluster when the 9 stickers disagree", () => {
    const refs = makeRefs();
    const grey: RGB = [120, 120, 120];
    const mixed: RGB[] = [baseRGB.U, baseRGB.U, baseRGB.U, baseRGB.U, baseRGB.U, grey, grey, grey, grey];
    const stats = observedFaceStats(mixed.map(rgb2lab), refs);
    expect(stats.clusterSpread).toBeGreaterThan(config.QUICK_ADJUST_CLUSTER_DE);
  });
});

describe("REGRESSION: additive-Lab shift is a rigid no-op for a pairwise gate (HIGH#1)", () => {
  it("an additive Lab offset to ALL refs leaves minPairwiseRefDE unchanged", () => {
    const refs = makeRefs();
    const before = minPairwiseRefDE(refs);
    // Rigid translation of every ref by the same Lab vector.
    const shift: Lab = [7, -5, 9];
    const shifted = {} as Refs;
    for (const name of COLOR_NAMES) {
      const [L, a, b] = refs[name];
      shifted[name] = [L + shift[0], a + shift[1], b + shift[2]];
    }
    const after = minPairwiseRefDE(shifted, "cie76");
    const beforeCie76 = minPairwiseRefDE(refs, "cie76");
    // CIE76 is a Euclidean metric → translation preserves EVERY pairwise distance
    // exactly. This is precisely why an additive-Lab "correction" makes any gate
    // computed on the refs a no-op — the convergence gate must live on the OBSERVED
    // face, and the real correction must be multiplicative (von-Kries).
    expect(after).toBeCloseTo(beforeCie76, 6);
    expect(before).toBeGreaterThan(0);
  });

  it("a multiplicative von-Kries gain does NOT preserve pairwise ΔE (not a rigid shift)", () => {
    const refs = makeRefs();
    const before = minPairwiseRefDE(refs, "cie76");
    const adjusted = applyVonKries(refs, LIGHT_B);
    const after = minPairwiseRefDE(adjusted, "cie76");
    expect(Math.abs(after - before)).toBeGreaterThan(1);
  });
});

describe("light-shift accuracy: von-Kries fixes a GLOBAL shift (honest about colour-selective)", () => {
  // A mixed cube: 54 stickers (9 of each colour) with light per-sticker noise.
  function mixedDeck(): { rgbs: RGB[]; truth: string[]; centerIdx: number[] } {
    const rgbs: RGB[] = [];
    const truth: string[] = [];
    const centerIdx: number[] = [];
    COLOR_NAMES.forEach((name, faceIdx) => {
      for (let cell = 0; cell < 9; cell++) {
        if (cell === 4) centerIdx.push(faceIdx * 9 + cell);
        rgbs.push(jitter(baseRGB[name], 6));
        truth.push(name);
      }
    });
    return { rgbs, truth, centerIdx };
  }

  // Full pipeline accuracy (centers pinned + 9x6 quota).
  function accuracyUnder(refs: Refs, deck: ReturnType<typeof mixedDeck>): number {
    const labs = deck.rgbs.map(rgb2lab);
    const res = assignQuota(labs, refs, deck.centerIdx);
    let ok = 0;
    res.assignment.forEach((c, i) => {
      if (c === deck.truth[i]) ok++;
    });
    return ok / labs.length;
  }

  // Per-sticker argmin (no quota) — sensitive, so it exposes where a correction
  // actually matters (the quota layer is robust enough to mask a global shift).
  function accuracyNaive(refs: Refs, deck: ReturnType<typeof mixedDeck>): number {
    const cls = classifyFace(deck.rgbs.map(rgb2lab), refs);
    let ok = 0;
    cls.forEach((c, i) => {
      if (c === deck.truth[i]) ok++;
    });
    return ok / cls.length;
  }

  it("profile under light A + global light B → quick-adjusted refs classify ≥ ACCURACY_PASS_FRAC", () => {
    const refsA = makeRefs();
    const deck = mixedDeck();
    // Re-photograph the SAME deck under light B (global per-channel gain).
    const deckB = {
      ...deck,
      rgbs: deck.rgbs.map((c) => applyLightGain(c, LIGHT_B)),
    };

    // Quick-adjust off ONE white face observed under B, then classify the B-lit cube.
    const whiteB = applyLightGain(baseRGB.U, LIGHT_B);
    const qa = quickAdjust(refsA, tightFace(whiteB));
    expect(qa.kind).toBe("ok");
    if (qa.kind !== "ok") return;

    // The correction genuinely moved the refs (not a no-op) and the corrected
    // full pipeline meets the same accuracy gate a fresh calibration under B would.
    expect(minPairwiseRefDE(qa.refs)).not.toBeCloseTo(minPairwiseRefDE(refsA), 3);
    expect(accuracyUnder(qa.refs, deckB)).toBeGreaterThanOrEqual(config.ACCURACY_PASS_FRAC);
  });

  it("HONEST: a colour-SELECTIVE shift (only the RED stickers fade) is NOT fixed by white-balance", () => {
    // von-Kries is a single global gain read off the white patch. A shift that moves
    // ONE colour (e.g. red stickers fading toward orange) is out of its reach — the
    // white face carries no signal about it. We assert the correction does NOT
    // magically recover such a case (documents the casual-only limitation, HIGH#2).
    // Uses the sensitive per-sticker classifier so the un-fixed error is visible.
    const refsA = makeRefs();
    const deck = mixedDeck();
    // Corrupt every RED sticker toward orange; leave the white untouched.
    const deckSel = {
      ...deck,
      rgbs: deck.rgbs.map((c, i) => (deck.truth[i] === "R" ? ([214, 118, 44] as RGB) : c)),
    };
    const whiteUnchanged = tightFace(baseRGB.U); // white reads clean → gain ≈ identity
    const qa = quickAdjust(refsA, whiteUnchanged);
    expect(qa.kind).toBe("ok");
    if (qa.kind !== "ok") return;
    // Near-identity white-balance leaves the red corruption intact: accuracy stays
    // depressed versus the clean deck. Not a magic fix — by design.
    expect(accuracyNaive(qa.refs, deckSel)).toBeLessThan(accuracyNaive(refsA, deck));
  });
});
