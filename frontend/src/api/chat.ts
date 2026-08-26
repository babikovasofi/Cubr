// Chat endpoints, Stage A only (swarm-report/friend-chat-plan.md §7 "Этап A").
// Shapes match the landed backend, not the plan's sketch — see coordinator's
// contract message. Delivery is long-polling — ONE poll loop per tab, not per
// conversation (§2): the caller keeps a single opaque `cursor` in state and
// re-issues `pollChat` in a loop, cancelling in-flight requests with an
// AbortController on unmount.

import { request } from "./client";

// Этап B (friends-hub plan): a duel invite's CURRENT state, embedded on a
// `kind === "invite"` message. `can_accept`/`can_decline`/`can_cancel` are
// CALLER-scoped (computed server-side, never re-derived here) — the
// frontend just disables/enables buttons off these booleans, never off
// "state === pending && am I the inviter" logic of its own that could drift
// from the server's rules. `session_token` is non-null only when the
// CALLER is a participant of an `accepted` invite — freshly minted on every
// read, which is how the inviter (who never calls accept themselves) gets
// their own token via their next poll-triggered refetch.
export interface DuelInviteRead {
  id: string;
  inviter_id: string;
  invitee_id: string;
  state: "pending" | "accepted" | "declined" | "canceled" | "expired";
  room_id: string | null;
  expires_at: string;
  can_accept: boolean;
  can_decline: boolean;
  can_cancel: boolean;
  seconds_left: number;
  session_token: string | null;
}

/** Response of `POST /chat/invites/{id}/accept|decline|cancel` — same shape
 * for all three. `session_token` is populated ONLY by accept. */
export interface DuelInviteActionRead {
  id: string;
  state: DuelInviteRead["state"];
  room_id: string | null;
  session_token: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  /** `null` = deleted (soft delete), OR always-null for `kind === "invite"`
   * (the invite itself carries the content). `deleted_at` marks the former. */
  body: string | null;
  /** `"text"` (default) or `"invite"` (Этап B — a duel-invite chat bubble). */
  kind: "text" | "invite";
  /** Non-null iff `kind === "invite"`. */
  invite: DuelInviteRead | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ConversationSummary {
  id: string;
  /** `null` = the friendship behind this conversation is gone (unfriended or
   * blocked) — the conversation stays read-only: no composer, no block/send. */
  friendship_id: string | null;
  display_name: string;
  last_message_body: string | null;
  /** Optional on the wire type here (not every fixture cares) — `"invite"`
   * means `last_message_body` is null NOT because the message was deleted,
   * see ConversationList's preview logic. */
  last_message_kind?: string | null;
  last_message_at: string | null;
  unread_count: number;
}

/** Poll response carries ONLY new messages — no conversation summaries, no
 * presence (Stage A has none; that is Stage C). Callers must refetch
 * `listConversations` after a non-empty poll to refresh unread badges. */
export interface ChatPollResult {
  cursor: string;
  messages: ChatMessage[];
}

export function sendMessage(
  friendshipId: string,
  body: string,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  return request<ChatMessage>(`/chat/conversations/${encodeURIComponent(friendshipId)}/messages`, {
    method: "POST",
    json: { body },
    signal,
  });
}

export function listConversations(signal?: AbortSignal): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>("/chat/conversations", { signal });
}

/** Oldest-first. */
export function listMessages(
  conversationId: string,
  opts: { afterSeq?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (opts.afterSeq !== undefined) params.set("after_seq", String(opts.afterSeq));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<ChatMessage[]>(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

/** Marks the WHOLE conversation read — no body, no per-message cursor. */
export function markRead(conversationId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: "POST",
    signal,
  });
}

export function deleteMessage(messageId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/chat/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
    signal,
  });
}

/**
 * Long-poll for new messages (§2). Resolves immediately when the server has
 * data, otherwise hangs up to ~25s server side. No cursor on the first call
 * watches from now — it does NOT return backlog; use `listMessages` for
 * history. Callers must pass an AbortSignal and re-issue this in a loop —
 * never one loop per conversation (browser connection limit + plan §2).
 */
export function pollChat(cursor: string | null, signal: AbortSignal): Promise<ChatPollResult> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<ChatPollResult>(`/chat/poll${qs}`, { signal });
}

/** Blocking also removes the friendship — the conversation's `friendship_id`
 * goes `null` after this. */
export function blockFriend(friendshipId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/chat/blocks/${encodeURIComponent(friendshipId)}`, {
    method: "POST",
    signal,
  });
}

/** `userId` is the friend's USER id, not a friendship id — after a block
 * there is no friendship_id left to key off. */
export function unblockFriend(userId: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/chat/blocks/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    signal,
  });
}

// ---------------------------------------------------------------------------
// Этап B — duel invite lifecycle (friends-hub plan)
// ---------------------------------------------------------------------------

/** Sends a duel-invite chat message. No duel room exists yet — only a
 * `pending` `duel_invites` row (skeptic HIGH#1: sending never costs a duel
 * slot, so N invites to N different friends all succeed). */
export function sendInvite(friendshipId: string, signal?: AbortSignal): Promise<ChatMessage> {
  return request<ChatMessage>(`/chat/conversations/${encodeURIComponent(friendshipId)}/invite`, {
    method: "POST",
    signal,
  });
}

/** Accepts a pending invite addressed to the caller — creates/joins the duel
 * room and returns the caller's own fresh `session_token`. */
export function acceptInvite(
  inviteId: string,
  signal?: AbortSignal,
): Promise<DuelInviteActionRead> {
  return request<DuelInviteActionRead>(`/chat/invites/${encodeURIComponent(inviteId)}/accept`, {
    method: "POST",
    signal,
  });
}

export function declineInvite(
  inviteId: string,
  signal?: AbortSignal,
): Promise<DuelInviteActionRead> {
  return request<DuelInviteActionRead>(`/chat/invites/${encodeURIComponent(inviteId)}/decline`, {
    method: "POST",
    signal,
  });
}

/** Cancels a pending invite the caller SENT. */
export function cancelInvite(
  inviteId: string,
  signal?: AbortSignal,
): Promise<DuelInviteActionRead> {
  return request<DuelInviteActionRead>(`/chat/invites/${encodeURIComponent(inviteId)}/cancel`, {
    method: "POST",
    signal,
  });
}
