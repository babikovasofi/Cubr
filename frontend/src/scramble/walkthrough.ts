// Pure step-machine for the scramble walkthrough. No DOM, no cubing — unit-tested.
// `index` is the number of moves ALREADY applied (0 = solved/start, M = all done),
// so the on-screen cube shows the state after `index` moves.

export interface Walkthrough {
  readonly moves: readonly string[];
  index: number;
}

export function makeWalkthrough(moves: readonly string[]): Walkthrough {
  return { moves, index: 0 };
}

export function totalSteps(w: Walkthrough): number {
  return w.moves.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Advance one move; clamped at the end. Returns the new index. */
export function next(w: Walkthrough): number {
  w.index = clamp(w.index + 1, 0, w.moves.length);
  return w.index;
}

/** Step back one move; clamped at 0. Returns the new index. */
export function prev(w: Walkthrough): number {
  w.index = clamp(w.index - 1, 0, w.moves.length);
  return w.index;
}

/** Jump to an absolute step (moves-applied count), clamped to [0, M]. */
export function goto(w: Walkthrough, n: number): number {
  w.index = clamp(Math.trunc(n), 0, w.moves.length);
  return w.index;
}

/** Algorithm string of the first `index` moves — the cube's state to render. */
export function algUpTo(w: Walkthrough): string {
  return w.moves.slice(0, w.index).join(" ");
}

/** The move that the CURRENT step is about to perform (the index-th move), or null at the end. */
export function currentMove(w: Walkthrough): string | null {
  return w.index < w.moves.length ? w.moves[w.index] : null;
}

/** The move that was JUST applied to reach this state (the (index-1)-th), or null at start. */
export function lastMove(w: Walkthrough): string | null {
  return w.index > 0 ? w.moves[w.index - 1] : null;
}

export function progressFraction(w: Walkthrough): number {
  return w.moves.length === 0 ? 1 : w.index / w.moves.length;
}

export function isFirst(w: Walkthrough): boolean {
  return w.index === 0;
}

export function isLast(w: Walkthrough): boolean {
  return w.index >= w.moves.length;
}
