// Generates one WCA 3x3 scramble per mount by fetching it from the backend
// (GET /scramble — public, rate-limited; see api/scramble.ts). StrictMode-safe
// via a cancelled flag. cubing/CDN is no longer used for scramble GENERATION —
// useTwisty.ts still loads it separately, for rendering only.
//
// Offline/dev-without-backend fallback: if the fetch fails, fall back to the
// local move generator (no network/CDN) so the ritual still starts.
//
// Bridge to verification: the scramble string is also fed to cubeState so the
// solo screen has the expected 54-char facelet reference to diff the camera read
// against (skeptic MED — explicit loading/error/retry, since the fetch can fail).
//
// Fixed mode (tournament reuse, П8): when `opts.fixed` is a server-issued scramble
// (from POST .../attempt/start), this hook NEVER fetches and NEVER falls back to a
// locally-generated scramble — the tournament ritual must run against exactly the
// server's shared scramble, with no client re-roll possible. `regenerate()` is a
// no-op in this mode. The non-fixed (solo) path below is untouched.

import { useEffect, useState } from "react";
import { fetchScramble } from "../../api/scramble";
import {
  randomScramble,
  randomStateFacelets,
  scrambleToFacelets,
  type Facelet,
} from "../../vision/cubeState";

/** Split a scramble string into individual move tokens (one per walkthrough step). */
export function parseMoves(alg: string): string[] {
  return alg.split(/\s+/).filter(Boolean);
}

/** Standalone generator (no React) — kept for callers that just need the wire shape. */
export async function generateScramble(): Promise<{ scramble: string; scrambleToken: string }> {
  const out = await fetchScramble();
  return { scramble: out.scramble, scrambleToken: out.scramble_token };
}

/**
 * Local, network-free scramble + expected facelets, used when the backend
 * fetch fails (offline / dev-without-backend). Two tiers: the normal
 * move-generator + replay first; if that somehow throws, a last-resort
 * derivation straight from a random legal cube state. If BOTH throw, the
 * caller surfaces an error (there is truly nothing to show).
 */
function localFallback(): { alg: string; facelets: Facelet } {
  try {
    const alg = randomScramble();
    const facelets = scrambleToFacelets(alg);
    return { alg, facelets };
  } catch {
    const { scramble, facelets } = randomStateFacelets();
    return { alg: scramble, facelets };
  }
}

export interface ScrambleData {
  scramble: string;
  // Signed token to thread back to POST /solves so the server can link
  // solve.scramble_id. null whenever the scramble came from the local
  // (offline/no-backend) fallback — those carry no server-verifiable token,
  // and the solo ritual must still save without one.
  scrambleToken: string | null;
  moves: string[];
  expectedFacelets: Facelet | null;
  loading: boolean;
  error: string | null;
  regenerate: () => void;
}

export interface UseScrambleOpts {
  /** Server-issued scramble to run against as-is — see the "Fixed mode" note above. */
  fixed?: string;
}

// Lazy initializers below read `opts.fixed` only once, at mount — fine because every
// caller either always passes a fixed scramble (tournament) or never does (solo); the
// tournament ritual component doesn't mount until the scramble already exists.
function initFixedMoves(fixed: string | undefined): string[] {
  return fixed ? parseMoves(fixed) : [];
}

function initFixedFacelets(fixed: string | undefined): Facelet | null {
  if (!fixed) return null;
  try {
    return scrambleToFacelets(fixed);
  } catch {
    return null;
  }
}

export function useScramble(opts?: UseScrambleOpts): ScrambleData {
  const fixed = opts?.fixed;
  const [scramble, setScramble] = useState(fixed ?? "");
  const [scrambleToken, setScrambleToken] = useState<string | null>(null);
  const [moves, setMoves] = useState<string[]>(() => initFixedMoves(fixed));
  const [expectedFacelets, setExpectedFacelets] = useState<Facelet | null>(() =>
    initFixedFacelets(fixed),
  );
  const [loading, setLoading] = useState(!fixed);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // Fixed mode: state was already set at init above — no fetch, no local
    // fallback, ever (П8: no client re-roll of the tournament scramble).
    if (fixed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Reset the token on every (re)generation, including regenerate(), so a
    // stale token from the previous scramble can never ride along with a new
    // scramble string while the fetch is in flight.
    setScrambleToken(null);
    (async () => {
      try {
        const { scramble: alg, scrambleToken: token } = await generateScramble();
        if (cancelled) return;
        let facelets: Facelet | null = null;
        try {
          facelets = scrambleToFacelets(alg);
        } catch {
          facelets = null;
        }
        if (cancelled) return;
        setScramble(alg);
        setScrambleToken(token);
        setMoves(parseMoves(alg));
        setExpectedFacelets(facelets);
        setLoading(false);
      } catch {
        // Backend unreachable (offline / dev-without-backend): fall back to a
        // local, network-free scramble so the ritual still starts. No server
        // token exists for a locally-generated scramble.
        if (cancelled) return;
        try {
          const { alg, facelets } = localFallback();
          if (cancelled) return;
          setScramble(alg);
          setScrambleToken(null);
          setMoves(parseMoves(alg));
          setExpectedFacelets(facelets);
          setLoading(false);
        } catch (e) {
          if (cancelled) return;
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, fixed]);

  return {
    scramble,
    scrambleToken,
    moves,
    expectedFacelets,
    loading,
    error,
    // No-op in fixed mode: the tournament scramble can never be re-rolled client-side.
    regenerate: fixed ? () => {} : () => setNonce((n) => n + 1),
  };
}
