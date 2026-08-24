// Chat endpoints, Stage A only (swarm-report/friend-chat-plan.md §7 "Этап A").
// Shapes match the landed backend, not the plan's sketch — see coordinator's
// contract message. Delivery is long-polling — ONE poll loop per tab, not per
// conversation (§2): the caller keeps a single opaque `cursor` in state and
// re-issues `pollChat` in a loop, cancelling in-flight requests with an
// AbortController on unmount.

import { request } from "./client";

export interface ChatMessage {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  /** `null` = deleted (soft delete). `deleted_at` is set together with it. */
  body: string | null;
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
