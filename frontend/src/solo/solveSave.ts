// Pure, testable helpers for persisting a finished solo solve (plan §B, #8).
// Kept free of React/hooks so the payload shape and the anon-skip are unit-tested
// in the node vitest env with a mocked create fn.

import type { SolveCreate, SolveRead } from "../api/solves";
import { ApiError } from "../api/client";

export type SaveState = "idle" | "saving" | "saved" | "failed" | "anon" | "unauthorized";

// Build the POST /solves body from the finished ritual. `time_ms` is rounded and
// clamped to >=1 because the backend requires time_ms > 0 (a DNF carries no real
// time, but the record still needs a positive placeholder).
export function buildSolvePayload(
  scramble: string,
  elapsedMs: number,
  dnf: boolean,
): SolveCreate {
  return {
    scramble,
    time_ms: Math.max(1, Math.round(elapsedMs)),
    status: dnf ? "dnf" : "valid",
    verify_frames_ok: !dnf,
  };
}

// Fire-and-forget save. Anonymous users are a no-op (solo still works locally).
// A 401 (expired JWT) is reported distinctly so the UI can keep the result and
// prompt a re-login instead of silently dropping it.
export async function saveSoloResult(opts: {
  isAuthed: boolean;
  payload: SolveCreate;
  create: (body: SolveCreate) => Promise<SolveRead>;
}): Promise<SaveState> {
  if (!opts.isAuthed) return "anon";
  try {
    await opts.create(opts.payload);
    return "saved";
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return "unauthorized";
    return "failed";
  }
}
