// Random-opponent matchmaking (friends-hub plan, Этап C). Mirrors
// useChallengeFriend's shape (busy/error/existingRoomId + a verb the
// component calls) but owns a poll LOOP while searching, not a single
// request — enqueue can return "queued, still waiting" (matched: false),
// which then needs GET /matchmaking/poll in a loop until a match lands or
// the caller cancels/navigates away.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  cancelMatchmaking,
  enqueueMatchmaking,
  pollMatchmaking,
  type MatchmakingStatusRead,
} from "../api/matchmaking";
import { saveDuelSessionToken, existingRoomIdFrom } from "../api/duel";
import { toast } from "../components/Toast";
import { useT } from "../i18n/t";

export type MatchmakingPhase = "idle" | "searching";

interface MatchmakingState {
  phase: MatchmakingPhase;
  error: string | null;
  existingRoomId: string | null;
}

const IDLE: MatchmakingState = { phase: "idle", error: null, existingRoomId: null };

function enterRoom(navigate: ReturnType<typeof useNavigate>, result: MatchmakingStatusRead): void {
  if (!result.room_id || !result.session_token) return;
  saveDuelSessionToken(result.room_id, result.session_token);
  navigate(`/duel/${result.room_id}`);
}

export function useMatchmaking() {
  const t = useT();
  const navigate = useNavigate();
  const [state, setState] = useState<MatchmakingState>(IDLE);
  // Poll loop's own abort handle — cancel() and unmount both need to stop an
  // in-flight long-poll immediately, not just flip a flag it hasn't read yet.
  const controllerRef = useRef<AbortController | null>(null);

  // External sync: leaving the queue is a real side effect on the server —
  // a tab closed or navigated away mid-search must not strand the caller
  // queued forever waiting for a stranger. Reads `controllerRef.current` at
  // CLEANUP time (a ref, not `state` — a state closure here would always see
  // the phase from the render that mounted this effect, i.e. always "idle").
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        void cancelMatchmaking().catch(() => undefined);
      }
    };
  }, []);

  async function pollLoop(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const result = await pollMatchmaking(controller.signal);
        if (controller.signal.aborted) return;
        if (result.matched) {
          controllerRef.current = null;
          setState(IDLE);
          enterRoom(navigate, result);
          return;
        }
        // matched: false — server timed out waiting (~25s); loop again.
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          controllerRef.current = null;
          return;
        }
        // Network blip — brief pause, then resume the same loop.
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async function search(): Promise<void> {
    setState({ phase: "searching", error: null, existingRoomId: null });
    try {
      const result = await enqueueMatchmaking();
      if (result.matched) {
        controllerRef.current = null;
        setState(IDLE);
        enterRoom(navigate, result);
        return;
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      void pollLoop(controller);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const message = t(e.message);
        // plan: Этап C — 409 already-in-game surfaces as a toast (same
        // treatment as the Этап B invite-accept 409, see InviteMessage).
        // The inline banner ALSO stays, carrying the "go to that duel" link
        // (existingRoomIdFrom) a bare toast can't hold.
        toast(message, "error");
        setState({
          phase: "idle",
          error: message,
          existingRoomId: existingRoomIdFrom(e),
        });
        return;
      }
      setState({
        phase: "idle",
        error: e instanceof ApiError ? t(e.message) : t("Не удалось найти соперника."),
        existingRoomId: null,
      });
    }
  }

  async function cancel(): Promise<void> {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(IDLE);
    try {
      await cancelMatchmaking();
    } catch {
      // best-effort — a stray queued row self-expires on the next enqueue's
      // get-or-create anyway (server-side, out of scope here)
    }
  }

  return { ...state, search, cancel };
}
