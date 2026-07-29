// Quick-adjust: one-WHITE-face session white-balance decision layer.
//
// Skeptic HIGH#1: the correction is a per-channel MULTIPLICATIVE gain applied in
// LINEAR-sRGB (see colors.vonKriesGain/applyVonKries), NOT an additive Lab offset.
// An additive Lab shift is a rigid translation → every pairwise ΔE is preserved →
// any convergence gate computed on the refs would be a no-op (regression test in
// colors.test.ts). The "converged" decision here is taken on the OBSERVED white
// face (cluster tightness + single-ref match margin, HIGH#2/#3), NEVER on the
// shifted refs. Pure functions only — no DOM.

import {
  applyVonKries,
  COLOR_NAMES,
  deltaE,
  median,
  rgb2lab,
  vonKriesGain,
  type ColorName,
  type Lab,
  type Refs,
  type RGB,
} from "./colors";
import { config, type DeltaEMode } from "./config";

function medianLab(labs: Lab[]): Lab {
  return [
    median(labs.map((l) => l[0])),
    median(labs.map((l) => l[1])),
    median(labs.map((l) => l[2])),
  ];
}

export interface ObservedFaceStats {
  center: Lab; // per-channel median of the 9 stickers
  clusterSpread: number; // max ΔE of any sticker to the center (tightness)
  nearestColor: ColorName; // ref the median matches best
  nearestDE: number;
  secondBestColor: ColorName;
  secondBestDE: number;
}

/**
 * Statistics of an OBSERVED 9-sticker face used for the quick-adjust convergence
 * gate (skeptic HIGH#1/#2). Cluster spread measures read tightness; the
 * nearest/second-best ΔE margin measures single-ref match confidence. Uses
 * config.DELTA_E_MODE so the gate matches the classifier.
 */
export function observedFaceStats(
  grid9: Lab[],
  refs: Refs,
  mode: DeltaEMode = config.DELTA_E_MODE,
): ObservedFaceStats {
  const center = medianLab(grid9);
  let clusterSpread = 0;
  for (const lab of grid9) clusterSpread = Math.max(clusterSpread, deltaE(lab, center, mode));

  let nearestColor: ColorName = COLOR_NAMES[0];
  let nearestDE = Infinity;
  let secondBestColor: ColorName = COLOR_NAMES[0];
  let secondBestDE = Infinity;
  for (const name of COLOR_NAMES) {
    const d = deltaE(center, refs[name], mode);
    if (d < nearestDE) {
      secondBestDE = nearestDE;
      secondBestColor = nearestColor;
      nearestDE = d;
      nearestColor = name;
    } else if (d < secondBestDE) {
      secondBestDE = d;
      secondBestColor = name;
    }
  }
  return { center, clusterSpread, nearestColor, nearestDE, secondBestColor, secondBestDE };
}

export type QuickAdjustDecision =
  | {
      kind: "ok";
      refs: Refs; // session-local, von-Kries–corrected refs
      matchedColor: ColorName; // always "U" on ok
      matchedDE: number;
      secondBestDE: number;
      clusterSpread: number;
      gain: [number, number, number];
    }
  // Shown face is not confidently white (wrong face, or a different cube): the
  // caller MUST route to full 6-face recalibration — never adjust on this.
  | { kind: "wrong-face"; nearestColor: ColorName; nearestDE: number }
  // Face IS white but the observed read did not converge (loose cluster or a weak
  // nearest-vs-second-best margin): refs are left untouched; caller recalibrates.
  | {
      kind: "diverged";
      reason: "cluster" | "margin";
      clusterSpread: number;
      nearestDE: number;
      secondBestDE: number;
    };

/**
 * Decide + compute the one-white-face quick adjustment. Pure: no DOM. The reader
 * feeds the 9 sampled sticker RGBs of the face the user claims is WHITE (U).
 *
 * Gate order (all on the OBSERVED face, skeptic HIGH#1/#3):
 *  1. wrong-face  — median's nearest ref is not U, or nearestΔE > QUICK_ADJUST_MATCH_DE.
 *  2. diverged    — 9-sticker cluster spread > QUICK_ADJUST_CLUSTER_DE, or the
 *                   (2nd-best − nearest) margin < QUICK_ADJUST_MARGIN_DE.
 *  3. ok          — von-Kries gain from the observed white median, applied to all 6 refs.
 */
export function quickAdjust(refs: Refs, observedGrid9: RGB[], cfg = config): QuickAdjustDecision {
  const labs = observedGrid9.map(rgb2lab);
  const stats = observedFaceStats(labs, refs, cfg.DELTA_E_MODE);

  // 1. Must be confidently the WHITE face (U). No "any face" — that is circular.
  if (stats.nearestColor !== "U" || stats.nearestDE > cfg.QUICK_ADJUST_MATCH_DE) {
    return { kind: "wrong-face", nearestColor: stats.nearestColor, nearestDE: stats.nearestDE };
  }
  // 2. Converged on the observed data?
  if (stats.clusterSpread > cfg.QUICK_ADJUST_CLUSTER_DE) {
    return {
      kind: "diverged",
      reason: "cluster",
      clusterSpread: stats.clusterSpread,
      nearestDE: stats.nearestDE,
      secondBestDE: stats.secondBestDE,
    };
  }
  if (stats.secondBestDE - stats.nearestDE < cfg.QUICK_ADJUST_MARGIN_DE) {
    return {
      kind: "diverged",
      reason: "margin",
      clusterSpread: stats.clusterSpread,
      nearestDE: stats.nearestDE,
      secondBestDE: stats.secondBestDE,
    };
  }

  // 3. Robust observed white = per-channel median of the 9 stickers.
  const observedWhite: RGB = [
    median(observedGrid9.map((c) => c[0])),
    median(observedGrid9.map((c) => c[1])),
    median(observedGrid9.map((c) => c[2])),
  ];
  const gain = vonKriesGain(observedWhite, refs.U);
  return {
    kind: "ok",
    refs: applyVonKries(refs, gain),
    matchedColor: "U",
    matchedDE: stats.nearestDE,
    secondBestDE: stats.secondBestDE,
    clusterSpread: stats.clusterSpread,
    gain,
  };
}

/**
 * Minimum pairwise ΔE among the six refs. A STORE-sanity metric only (are any two
 * colours dangerously close under this light) — explicitly NOT the quick-adjust
 * convergence gate, which is computed on the observed face (skeptic HIGH#1).
 */
export function minPairwiseRefDE(refs: Refs, mode: DeltaEMode = config.DELTA_E_MODE): number {
  let min = Infinity;
  for (let i = 0; i < COLOR_NAMES.length; i++) {
    for (let j = i + 1; j < COLOR_NAMES.length; j++) {
      min = Math.min(min, deltaE(refs[COLOR_NAMES[i]], refs[COLOR_NAMES[j]], mode));
    }
  }
  return min;
}
