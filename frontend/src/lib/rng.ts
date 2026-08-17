// Seeded PRNG. Nothing in the repo needs a reproducible random sequence yet —
// everything reaches for `Math.random` directly — so this is the first one.
// General-purpose: not trainer-specific, just lives here because that's where
// small standalone helpers go (see formatTime.ts, device.ts).
//
// mulberry32: https://gist.github.com/tommyettinger/46a874533244883189143505d203312
// Small, fast, decent statistical quality for non-cryptographic use (shuffles,
// deterministic test fixtures, "pick one of N" draws) — not for anything
// security-sensitive.

/** Seeded generator: same seed -> same infinite sequence of values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
