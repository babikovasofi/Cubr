// Mounts a single <twisty-player> (cubing, loaded from CDN — see cubingCdn.ts,
// NOT bundled) into a ref'd slot. React 19 mounts the custom element imperatively.
//
// StrictMode-safe: the mount effect uses a `cancelled` flag + captured local slot;
// cleanup sets cancelled=true, clears the slot, drops the player. No module-level
// "already mounted" guard, so the double mount cannot leak a second player.
//
// Fixed orientation (white top, green front): the player never does whole-cube
// rotations, only the scramble's layer turns.

import { useEffect, useRef, useState } from "react";
import { loadCubing, type TwistyPlayerEl } from "../cubingCdn";

type AnimatablePlayer = TwistyPlayerEl & {
  jumpToStart?: () => void;
  play?: () => void;
};

const PLAYER_OPTS: Record<string, unknown> = {
  puzzle: "3x3x3",
  alg: "",
  background: "none",
  controlPanel: "none",
  hintFacelets: "none",
  cameraLatitude: 22,
  cameraLongitude: -22,
};

export function useTwisty() {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<AnimatablePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const slot = slotRef.current;
    if (!slot) return;
    (async () => {
      try {
        const { TwistyPlayer } = await loadCubing();
        if (cancelled) return;
        const p = new TwistyPlayer(PLAYER_OPTS) as AnimatablePlayer;
        if (cancelled) return;
        playerRef.current = p;
        slot.replaceChildren(p);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
      slot.replaceChildren();
      playerRef.current = null;
    };
  }, []);

  /** Render the cube state after the first `n` moves, statically (no animation). */
  const showState = (moves: readonly string[], n: number): void => {
    const p = playerRef.current;
    if (!p) return;
    p.experimentalSetupAlg = moves.slice(0, n).join(" ");
    p.alg = "";
  };

  /** Animate the transition INTO the state after `n` moves (plays move n-1). */
  const animateMove = (moves: readonly string[], n: number): void => {
    const p = playerRef.current;
    if (!p) return;
    if (n <= 0) {
      showState(moves, 0);
      return;
    }
    p.experimentalSetupAlg = moves.slice(0, n - 1).join(" ");
    p.alg = moves[n - 1];
    p.jumpToStart?.();
    p.play?.();
  };

  return { slotRef, ready, error, showState, animateMove };
}
