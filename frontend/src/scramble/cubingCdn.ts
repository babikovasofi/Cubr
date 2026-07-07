// Central cubing loader. IMPORTANT (see swarm-report/scramble-walkthrough-proto-
// build.md): cubing must NOT be bundled by Vite — randomScrambleForEvent runs its
// solver in a module web-worker, and Vite's prod worker bundling throws
// "Module worker instantiation failed" at runtime (dev ok, prod broken). The
// official CDN build wires the workers correctly, so we load it as remote ESM
// (same pattern the vision rig uses for the MediaPipe wasm/model). Runtime net dep.

const SCRAMBLE_URL = "https://cdn.cubing.net/v0/js/cubing/scramble";
const TWISTY_URL = "https://cdn.cubing.net/v0/js/cubing/twisty";

type RandomScrambleForEvent = (eventID: string) => Promise<{ toString(): string }>;
export type TwistyPlayerEl = HTMLElement & { alg: string; experimentalSetupAlg: string };
type TwistyPlayerCtor = new (opts: Record<string, unknown>) => TwistyPlayerEl;

export interface Cubing {
  randomScrambleForEvent: RandomScrambleForEvent;
  TwistyPlayer: TwistyPlayerCtor;
}

let cache: Promise<Cubing> | null = null;

export function loadCubing(): Promise<Cubing> {
  if (!cache) {
    cache = (async () => {
      const [scramble, twisty] = await Promise.all([
        import(/* @vite-ignore */ SCRAMBLE_URL) as Promise<{
          randomScrambleForEvent: RandomScrambleForEvent;
        }>,
        import(/* @vite-ignore */ TWISTY_URL) as Promise<{ TwistyPlayer: TwistyPlayerCtor }>,
      ]);
      return {
        randomScrambleForEvent: scramble.randomScrambleForEvent,
        TwistyPlayer: twisty.TwistyPlayer,
      };
    })();
    // Don't cache a failed load (offline/CDN down) — otherwise every later call
    // returns the same rejected promise and the user can't retry without a full
    // page reload. Drop the cache on rejection so the next call re-attempts.
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}
