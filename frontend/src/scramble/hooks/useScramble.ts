// Generates one WCA 3x3 scramble per mount via cubing's randomScrambleForEvent
// (async, ESM from CDN — cubingCdn.ts). StrictMode-safe via a cancelled flag.
//
// Bridge to verification: the scramble string is also fed to cubeState so the
// solo screen has the expected 54-char facelet reference to diff the camera read
// against (skeptic MED — explicit loading/error/retry, since the CDN can fail).

import { useEffect, useState } from "react";
import { loadCubing } from "../cubingCdn";
import { scrambleToFacelets, type Facelet } from "../../vision/cubeState";

/** Split a scramble string into individual move tokens (one per walkthrough step). */
export function parseMoves(alg: string): string[] {
  return alg.split(/\s+/).filter(Boolean);
}

/** Standalone generator (no React) — kept for callers that just need a string. */
export async function generateScramble(): Promise<string> {
  const { randomScrambleForEvent } = await loadCubing();
  const alg = await randomScrambleForEvent("333");
  return alg.toString().trim();
}

export interface ScrambleData {
  scramble: string;
  moves: string[];
  expectedFacelets: Facelet | null;
  loading: boolean;
  error: string | null;
  regenerate: () => void;
}

export function useScramble(): ScrambleData {
  const [scramble, setScramble] = useState("");
  const [moves, setMoves] = useState<string[]>([]);
  const [expectedFacelets, setExpectedFacelets] = useState<Facelet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const alg = await generateScramble();
        if (cancelled) return;
        let facelets: Facelet | null = null;
        try {
          facelets = scrambleToFacelets(alg);
        } catch {
          facelets = null;
        }
        if (cancelled) return;
        setScramble(alg);
        setMoves(parseMoves(alg));
        setExpectedFacelets(facelets);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return {
    scramble,
    moves,
    expectedFacelets,
    loading,
    error,
    regenerate: () => setNonce((n) => n + 1),
  };
}
