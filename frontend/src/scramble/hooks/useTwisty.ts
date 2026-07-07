// STUB hook (Stage 1.2 wires it). Mounts a <twisty-player> (cubing, loaded from
// CDN — see cubingCdn.ts, NOT bundled) into a ref'd slot. In React 19 the player
// is a custom element mounted imperatively, so 1.2 must: mount in useEffect
// against a ref, clear the slot + drop the player in cleanup, and guard the
// StrictMode double-invoke. Skeleton only here.
import { useRef } from "react";
import { loadCubing } from "../cubingCdn";

export function useTwisty() {
  const slotRef = useRef<HTMLDivElement | null>(null);

  // Skeleton — 1.2 does the ref-based mount/cleanup. Exposed so the type is stable.
  async function mount(): Promise<void> {
    await loadCubing();
    throw new Error("useTwisty.mount not implemented until Stage 1.2");
  }

  return { slotRef, mount };
}
