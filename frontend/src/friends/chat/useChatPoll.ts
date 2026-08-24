// One long-poll loop for the whole tab (plan §2 — never one loop per
// conversation: the browser caps concurrent connections per origin, and a
// per-conversation loop would blow past that the moment someone has a few
// chats open). This hook owns the loop, the opaque cursor, the conversation
// list and per-conversation message caches; ChatSection is the single place
// that mounts it.
//
// Poll shape from the landed backend: {cursor, messages} ONLY — no
// conversation summaries, no presence (Stage A has none). A non-empty poll
// means "something changed somewhere"; we append the messages we can place
// and refetch the conversation list for fresh unread badges.
//
// External sync via useEffect: the poll is a subscription to a server-side
// event stream standing in for a socket, not state derived from props — see
// react-ts agent rules on useEffect scope.

import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  listConversations,
  listMessages,
  pollChat,
  type ChatMessage,
  type ConversationSummary,
} from "../../api/chat";

export interface ChatPollState {
  conversations: ConversationSummary[];
  messagesByConversationId: Record<string, ChatMessage[]>;
  loadState: "loading" | "ok" | "error";
  error: string | null;
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
}

// Backoff for a failed poll (network blip, container restart mid-request —
// plan §2). The client just resumes with the same cursor, no data is lost.
const POLL_RETRY_DELAY_MS = 3000;

export function useChatPoll() {
  const [state, setState] = useState<ChatPollState>({
    conversations: [],
    messagesByConversationId: {},
    loadState: "loading",
    error: null,
  });
  // Cursor lives in a ref, not state: the poll loop reads it synchronously
  // between iterations and must never restart from a stale render's closure.
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function refetchConversations() {
      try {
        const conversations = await listConversations(controller.signal);
        if (!alive) return;
        setState((s) => ({ ...s, conversations, loadState: "ok", error: null }));
      } catch (e) {
        if (!alive || controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          loadState: "error",
          error: e instanceof ApiError ? e.message : "Не удалось загрузить переписки.",
        }));
      }
    }

    async function loop() {
      await refetchConversations();
      while (alive) {
        try {
          const result = await pollChat(cursorRef.current, controller.signal);
          cursorRef.current = result.cursor;
          if (!alive) return;
          if (result.messages.length === 0) continue;
          setState((s) => {
            const messagesByConversationId = { ...s.messagesByConversationId };
            for (const msg of result.messages) {
              const existing = messagesByConversationId[msg.conversation_id] ?? [];
              messagesByConversationId[msg.conversation_id] = mergeMessages(existing, [msg]);
            }
            return { ...s, messagesByConversationId };
          });
          // Poll carries no unread/last-message summary — refresh the list
          // separately for those (plan/backend contract).
          void refetchConversations();
        } catch (e) {
          if (!alive || controller.signal.aborted) return;
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return;
          await new Promise((r) => setTimeout(r, POLL_RETRY_DELAY_MS));
        }
      }
    }

    void loop();
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  async function refreshConversations(): Promise<void> {
    try {
      const conversations = await listConversations();
      setState((s) => ({ ...s, conversations }));
    } catch {
      // best-effort: the poll loop will eventually pick up the same data
    }
  }

  async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
    const page = await listMessages(conversationId, { limit: 50 });
    let merged: ChatMessage[] = page;
    setState((s) => {
      merged = mergeMessages(s.messagesByConversationId[conversationId] ?? [], page);
      return {
        ...s,
        messagesByConversationId: { ...s.messagesByConversationId, [conversationId]: merged },
      };
    });
    return merged;
  }

  function applyLocalMessage(conversationId: string, message: ChatMessage): void {
    setState((s) => ({
      ...s,
      messagesByConversationId: {
        ...s.messagesByConversationId,
        [conversationId]: mergeMessages(s.messagesByConversationId[conversationId] ?? [], [
          message,
        ]),
      },
    }));
  }

  function applyLocalDelete(conversationId: string, messageId: string): void {
    setState((s) => ({
      ...s,
      messagesByConversationId: {
        ...s.messagesByConversationId,
        [conversationId]: (s.messagesByConversationId[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, body: null, deleted_at: new Date().toISOString() } : m,
        ),
      },
    }));
  }

  function applyLocalConversationPatch(
    conversationId: string,
    patch: Partial<ConversationSummary>,
  ): void {
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, ...patch } : c,
      ),
    }));
  }

  return {
    ...state,
    refreshConversations,
    loadHistory,
    applyLocalMessage,
    applyLocalDelete,
    applyLocalConversationPatch,
  };
}

export type UseChatPoll = ReturnType<typeof useChatPoll>;
