// Friend endpoints (plan: friends). Mirrors backend/app/schemas/friend.py.
//
// `friendship_id` is the id of the FRIENDSHIP ROW, not a user id — it is the
// ONLY identifier this module (or anything downstream of it) ever exposes for
// a friend/request. No email or user UUID exists on any response type here
// by contract (see plan Acceptance criteria) — `display_name` is already
// "Аноним" for a user with no `handle` set, computed server-side.

import { request } from "./client";

export interface FriendRead {
  friendship_id: string;
  display_name: string;
  since: string;
  // friends-hub plan, Этап A: presence dot — `user_presence.last_seen_at`
  // within the server's online window. Always present on the wire (server
  // default False, not omitted), so this is NOT optional here.
  is_online: boolean;
}

export interface FriendRequestRead {
  friendship_id: string;
  display_name: string;
  created_at: string;
}

export function listFriends(signal?: AbortSignal): Promise<FriendRead[]> {
  return request<FriendRead[]>("/friends", { signal });
}

export function listIncoming(signal?: AbortSignal): Promise<FriendRequestRead[]> {
  return request<FriendRequestRead[]>("/friends/requests/incoming", { signal });
}

export function listOutgoing(signal?: AbortSignal): Promise<FriendRequestRead[]> {
  return request<FriendRequestRead[]>("/friends/requests/outgoing", { signal });
}

export function sendRequest(handle: string, signal?: AbortSignal): Promise<FriendRequestRead> {
  return request<FriendRequestRead>("/friends/requests", {
    method: "POST",
    json: { handle },
    signal,
  });
}

export function acceptRequest(friendshipId: string, signal?: AbortSignal): Promise<FriendRead> {
  return request<FriendRead>(`/friends/requests/${encodeURIComponent(friendshipId)}/accept`, {
    method: "POST",
    signal,
  });
}

// Declines an incoming request OR cancels an outgoing one — same endpoint,
// the backend disambiguates by which side of the row the caller is on (plan
// §7). Either way the row is deleted, so a repeat request is possible again.
export function deleteRequest(friendshipId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/friends/requests/${encodeURIComponent(friendshipId)}`, {
    method: "DELETE",
    signal,
  });
}

export function removeFriend(friendshipId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/friends/${encodeURIComponent(friendshipId)}`, {
    method: "DELETE",
    signal,
  });
}
