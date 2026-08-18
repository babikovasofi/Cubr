// "Вызвать" button on a friend row (plan: friends §13, Decision #2). Creates a
// duel room via the EXISTING POST /duel/rooms and navigates straight into it
// — same mechanism as HomePage's Dashboard.startDuel / DuelPage's rematch, no
// new backend surface. There is deliberately no persistent "incoming
// challenge" — the value is skipping the trip through the general duel
// screen to re-copy a link, not a notification (see InvitePanel's added line
// and the plan's Decision #2 — no delivery is faked here).
//
// A 409 (П11: caller already has another active room) must not crash the
// friends list — it degrades to an inline offer to jump into that room,
// reusing the exact copy DuelRoom.tsx already shows for the same case so the
// two spots never drift.

import { useState } from "react";
import { ApiError } from "../api/client";
import { createRoom, existingRoomIdFrom, saveDuelSessionToken } from "../api/duel";
import { useT } from "../i18n/t";
import { useNavigate } from "react-router-dom";

interface ChallengeState {
  busy: boolean;
  error: string | null;
  existingRoomId: string | null;
}

const IDLE: ChallengeState = { busy: false, error: null, existingRoomId: null };

export function useChallengeFriend() {
  const t = useT();
  const navigate = useNavigate();
  const [state, setState] = useState<ChallengeState>(IDLE);

  async function challenge(): Promise<void> {
    setState({ busy: true, error: null, existingRoomId: null });
    try {
      const room = await createRoom();
      saveDuelSessionToken(room.room_id, room.session_token);
      navigate(`/duel/${room.room_id}`, { state: { joinUrl: room.join_url } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setState({
          busy: false,
          error: t(
            "У тебя уже есть активная дуэль — одновременно можно участвовать только в одной.",
          ),
          existingRoomId: existingRoomIdFrom(e),
        });
        return;
      }
      setState({
        busy: false,
        error:
          e instanceof ApiError ? t(e.message) : t("Не удалось создать дуэль. Попробуй ещё раз."),
        existingRoomId: null,
      });
    }
  }

  return { ...state, challenge };
}
