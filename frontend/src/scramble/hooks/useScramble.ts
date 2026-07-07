// STUB hook (Stage 1.2 wires it). Generates a WCA 3x3 scramble via cubing's
// randomScrambleForEvent (async, loaded from CDN — cubingCdn.ts). Skeleton only.
import { loadCubing } from "../cubingCdn";

export async function generateScramble(): Promise<string> {
  const { randomScrambleForEvent } = await loadCubing();
  const alg = await randomScrambleForEvent("333");
  return alg.toString();
}

export function useScramble() {
  return { generateScramble };
}
