import { loadCubing } from "./cubingCdn.ts";

/** A random WCA 3x3 scramble as a notation string, e.g. "R U' F2 D ...". */
export async function generateScramble(): Promise<string> {
  const { randomScrambleForEvent } = await loadCubing();
  const alg = await randomScrambleForEvent("333");
  return alg.toString().trim();
}

/** Split a scramble string into individual move tokens (one per walkthrough step). */
export function parseMoves(alg: string): string[] {
  return alg.split(/\s+/).filter(Boolean);
}
