// Random-opponent matchmaking endpoints (friends-hub plan, Этап C). Mirrors
// backend/app/schemas/matchmaking.py. `GET /matchmaking/poll` long-polls up
// to ~25s server side, same delivery shape as `pollChat` — callers loop it
// while "searching", cancelling in-flight requests on unmount/cancel.

import { request } from "./client";

/** Response of enqueue AND poll — same shape either way. `matched: false`
 * is a normal "still waiting" outcome, not an error. */
export interface MatchmakingStatusRead {
  matched: boolean;
  room_id: string | null;
  session_token: string | null;
}

/** Joins the queue, or pairs immediately if a candidate is already waiting.
 * 409 `MATCHMAKING_ALREADY_IN_GAME` if the caller already has another
 * active duel — see `existingRoomIdFrom` in `./duel` to read the room id
 * off that error. */
export function enqueueMatchmaking(signal?: AbortSignal): Promise<MatchmakingStatusRead> {
  return request<MatchmakingStatusRead>("/matchmaking/enqueue", { method: "POST", signal });
}

/** Leaves the queue. Idempotent — 204 even if the caller wasn't queued. */
export function cancelMatchmaking(signal?: AbortSignal): Promise<void> {
  return request<void>("/matchmaking/cancel", { method: "POST", signal });
}

/** Long-poll: has the caller been matched yet? Never 404 — an un-queued
 * caller just reads `matched: false` forever, same as a queued-but-waiting
 * one; callers only ever poll after a successful `enqueue` anyway. */
export function pollMatchmaking(signal: AbortSignal): Promise<MatchmakingStatusRead> {
  return request<MatchmakingStatusRead>("/matchmaking/poll", { signal });
}
