// Solve-time display formatting. One pure formatter, two user-chosen formats:
//   "seconds" — always total seconds, 2 decimals: 12.34, 83.45
//   "clock"   — minutes:seconds at/over a minute, plain seconds under it:
//               12.34, 1:23.45, 1:03.05, 10:00.00 (standard cubing convention)
// The setting lives in store/settingsStore.ts; this module stays pure/testable.

export type TimeFormat = "seconds" | "clock";

export const TIME_FORMATS: readonly TimeFormat[] = ["clock", "seconds"] as const;

/** Format a solve duration (ms) for display. Pure. Negative → clamped to 0. */
export function formatSolveMs(ms: number, format: TimeFormat): string {
  const cs = Math.max(0, Math.round(ms / 10)); // centiseconds — single rounding basis
  const totalSec = cs / 100;
  if (format === "seconds" || cs < 6000) {
    return totalSec.toFixed(2);
  }
  const min = Math.floor(cs / 6000);
  const sec = (cs - min * 6000) / 100;
  return `${min}:${sec.toFixed(2).padStart(5, "0")}`;
}
