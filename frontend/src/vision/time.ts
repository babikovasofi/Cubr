// Tiny pure time formatter for the solve timer. Kept separate from the DOM so it
// is unit-testable and shared between the per-frame DOM write (SoloPage's rVFC
// loop) and the frozen React value. Milliseconds in -> "S.mmm" seconds string.

/** Format an elapsed duration in ms as fixed-3 seconds, e.g. 12345 -> "12.345". */
export function fmtSec(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  // Round to the nearest whole millisecond FIRST, then format. Formatting the
  // float seconds directly (e.g. (1234.5/1000).toFixed(3)) rounds the wrong way
  // at the half-ms boundary because 1.2345 is ~1.23449999 in IEEE754.
  return (Math.round(ms) / 1000).toFixed(3);
}
