// Duel-by-link endpoints (Этап 4, plan: stage4-duel-by-link). Mirrors
// backend/app/schemas/duel.py + docs/ws-protocol.md (backend-authored in the
// same swarm run — reconcile field names there if they drift from this file).
// REST NEVER carries the scramble — it's revealed only via WS `start`, see
// duel/useDuelSocket.ts. Authed only; anon gets 401 from every endpoint here.

import { ApiError, request } from "./client";

export type DuelRoomStatus = "open" | "full" | "active" | "finished" | "abandoned";

// POST /duel/rooms and POST /duel/rooms/{room_id}/rematch — `session_token` is
// HMAC-bound to (room_id, caller's user_id) and authenticates the WS handshake
// (see useDuelSocket.ts / plan services/duel_token.py).
export interface DuelRoomCreateRead {
  room_id: string;
  invite_token: string;
  session_token: string;
  mode: string;
  event: string;
  join_url: string;
}

// GET /duel/rooms/{id} — participant-only bootstrap/reconnect snapshot.
// Deliberately has NO `scramble` field (revealed only through WS `start`/
// `room_state`, П-invariant mirrored from the tournament brick).
export interface DuelRoomRead {
  room_id: string;
  status: DuelRoomStatus;
  mode: string;
  event: string;
  your_slot: "a" | "b";
  opponent_present: boolean;
}

// POST /duel/join/{invite_token}
export interface DuelJoinRead {
  room_id: string;
  session_token: string;
  status: DuelRoomStatus;
}

export function createRoom(signal?: AbortSignal): Promise<DuelRoomCreateRead> {
  return request<DuelRoomCreateRead>("/duel/rooms", { method: "POST", signal });
}

export function getRoom(roomId: string, signal?: AbortSignal): Promise<DuelRoomRead> {
  return request<DuelRoomRead>(`/duel/rooms/${encodeURIComponent(roomId)}`, { signal });
}

export function joinRoom(inviteToken: string, signal?: AbortSignal): Promise<DuelJoinRead> {
  return request<DuelJoinRead>(`/duel/join/${encodeURIComponent(inviteToken)}`, {
    method: "POST",
    signal,
  });
}

// Idempotent: keyed on parent_room_id server-side, so a double click from
// either/both players get-or-create the SAME child room (plan MED fix).
export function rematch(roomId: string, signal?: AbortSignal): Promise<DuelRoomCreateRead> {
  return request<DuelRoomCreateRead>(`/duel/rooms/${encodeURIComponent(roomId)}/rematch`, {
    method: "POST",
    signal,
  });
}

// Same-origin, relative WS URL — the httpOnly `cubr_auth` cookie rides the
// handshake automatically same as REST (see client.ts). Dev goes through the
// Vite proxy (vite.config.ts proxy["/api"].ws = true); prod through whatever
// reverse proxy fronts /api.
export function wsUrl(roomId: string, sessionToken: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/duel/ws/${encodeURIComponent(
    roomId,
  )}?token=${encodeURIComponent(sessionToken)}`;
}

// session_token is only ever returned by POST create/join/rematch — a direct
// navigation or page refresh at /duel/:roomId has no REST way to fetch a
// fresh one (GET /duel/rooms/{id} deliberately excludes it; that route is
// participant-only via the auth cookie, a different mechanism entirely from
// the WS-specific session_token). Persisted per-tab in sessionStorage so a
// reload can still reopen the WS. A token from a DIFFERENT browser/tab is
// NOT recoverable this way — re-using the invite link (join) is the actual
// recovery path for that case, matching the plan's "join идемпотентно тот
// же room" behavior for a participant.
const SESSION_KEY_PREFIX = "cubr_duel_session_";

export function saveDuelSessionToken(roomId: string, token: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + roomId, token);
  } catch {
    // sessionStorage unavailable (private mode / disabled) — non-fatal, the
    // WS just won't survive a reload in that browser.
  }
}

export function loadDuelSessionToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY_PREFIX + roomId);
  } catch {
    return null;
  }
}

// П11 conflict (create or join while the caller already has another active
// duel) carries `existing_room_id` alongside the usual {code, reason} 409
// shape — CONTRACT AMBIGUITY (backend schema not finalized as of writing):
// this checks both a top-level field and a nested `detail.existing_room_id`
// so it degrades to null (no deep-link offered) rather than throwing if the
// backend picks a different shape.
export function existingRoomIdFrom(e: ApiError): string | null {
  const body = e.body;
  if (!body || typeof body !== "object") return null;
  const top = (body as Record<string, unknown>).existing_room_id;
  if (typeof top === "string") return top;
  const detail = (body as Record<string, unknown>).detail;
  if (detail && typeof detail === "object") {
    const nested = (detail as Record<string, unknown>).existing_room_id;
    if (typeof nested === "string") return nested;
  }
  return null;
}
