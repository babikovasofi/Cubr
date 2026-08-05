// Pure, testable helpers for persisting a finished solo solve (plan §B, #8).
// Kept free of React/hooks so the payload shape and the anon-skip are unit-tested
// in the node vitest env with a mocked create fn.

import type { SolveCreate, SolveRead } from "../api/solves";
import type { BadgeRead } from "../api/badges";
import { ApiError } from "../api/client";

export type SaveState = "idle" | "saving" | "saved" | "failed" | "anon" | "unauthorized";

// Build the POST /solves body from the finished ritual. `time_ms` is rounded and
// clamped to >=1 because the backend requires time_ms > 0 (a DNF carries no real
// time, but the record still needs a positive placeholder).
//
// NOTE (skeptic HIGH#4): the `validated` flag (full 6-face vs. seeded+quick-adjust)
// is carried at the SESSION level (useSoloSession) and surfaced in the UI, but is
// NOT sent here — the backend SolveCreate schema is `extra="forbid"` and has no
// column for it yet (Stage-4 ranked gate, out of scope). Threading it onto the wire
// would 422. Keep it off the payload until the schema grows a field.
// (scramble_id/scramble_token ARE on the wire now — see the scrambleToken param
// below; this note is specifically about the still-unsent `validated` flag.)
//
// `verify_frames_ok`: true only when the ritual reached "result" via an actual
// camera-verified read on BOTH verify screens. `cameraVerified` goes false the
// moment either screen was skipped via the demo escape hatch ("Пропустить" after
// repeated read failures) — a skipped result must never look camera-verified.
//
// `scrambleToken`: the signed token from GET /scramble (api/scramble.ts), threaded
// through so the server can verify + lazily persist the scramble and set
// solve.scramble_id. null for the offline/anon local-fallback scramble (no
// server-issued token exists) — the ritual must still save with no token.
export function buildSolvePayload(
  scramble: string,
  elapsedMs: number,
  dnf: boolean,
  cubeId: string | null = null,
  cameraVerified: boolean = true,
  scrambleToken: string | null = null,
): SolveCreate {
  return {
    scramble,
    time_ms: Math.max(1, Math.round(elapsedMs)),
    status: dnf ? "dnf" : "valid",
    verify_frames_ok: !dnf && cameraVerified,
    cube_id: cubeId,
    scramble_token: scrambleToken,
  };
}

// Fire-and-forget save. Anonymous users are a no-op (solo still works locally).
// A 401 (expired JWT) is reported distinctly so the UI can keep the result and
// prompt a re-login instead of silently dropping it.
//
// `onNewBadges` (plan: achievements-badges) fires with the solve response's
// `new_badges` (if any) on success — kept as a plain callback rather than an
// import of the Toast module so this file stays free of React/hooks and easy
// to unit-test with a mocked `create` fn.
export async function saveSoloResult(opts: {
  isAuthed: boolean;
  payload: SolveCreate;
  create: (body: SolveCreate) => Promise<SolveRead>;
  onNewBadges?: (badges: BadgeRead[]) => void;
}): Promise<SaveState> {
  if (!opts.isAuthed) return "anon";
  try {
    const solve = await opts.create(opts.payload);
    if (solve.new_badges && solve.new_badges.length > 0) opts.onNewBadges?.(solve.new_badges);
    return "saved";
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return "unauthorized";
    return "failed";
  }
}
