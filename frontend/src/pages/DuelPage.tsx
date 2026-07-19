// /duel/:roomId — duel room bootstrap + WS wiring (plan: stage4-duel-by-link,
// wrapped in ProtectedRoute by App.tsx). GET /duel/rooms/{id} confirms
// participancy (cookie-authed) and seeds room metadata; the WS socket then
// takes over as the source of truth for phase (room_state/start/...) — see
// duel/duelMachine.ts's top comment for the room_state `phase` contract
// assumption this file relies on.

import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getBadges } from "../api/badges";
import { ApiError } from "../api/client";
import {
  existingRoomIdFrom,
  getRoom,
  loadDuelSessionToken,
  rematch,
  saveDuelSessionToken,
} from "../api/duel";
import { toast } from "../components/Toast";
import DuelResult from "../duel/DuelResult";
import DuelRoom from "../duel/DuelRoom";
import { duelReducer, initialDuelState } from "../duel/duelMachine";
import { useDuelSocket } from "../duel/useDuelSocket";

interface DuelLocationState {
  joinUrl?: string;
}

export default function DuelPage() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(duelReducer, initialDuelState);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);

  // Only present right after HomePage's createRoom / DuelPage's own onRematch
  // navigate() — a bookmarked/reloaded /duel/:roomId simply won't show the
  // invite link (DuelRoom degrades to a plain "waiting" message instead).
  const joinUrl = (location.state as DuelLocationState | null)?.joinUrl ?? null;

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "connect_start" });

    async function bootstrap(): Promise<void> {
      try {
        const room = await getRoom(roomId);
        if (cancelled) return;
        const sessionToken = loadDuelSessionToken(roomId);
        if (!sessionToken) {
          // Participant per the cookie-authed GET, but no WS session_token
          // survived in this browser (new tab/device) — nothing to reconnect
          // with; point back at "not found" rather than hanging forever.
          dispatch({ type: "room_not_found" });
          return;
        }
        dispatch({ type: "bootstrap_ok", room, sessionToken });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          dispatch({ type: "room_not_found" });
        } else if (e instanceof ApiError && e.status === 409) {
          dispatch({ type: "duel_already_active", existingRoomId: existingRoomIdFrom(e) });
        } else {
          dispatch({ type: "room_not_found" });
        }
      }
    }
    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Duel badge toast (plan: achievements-badges, client refetch-diff — the WS
  // `result` message and FinalizeCallback are NOT threaded with `new_badges`,
  // see plan Out of scope). Snapshot the caller's earned codes on mount/roomId
  // change, then diff against a refetch the moment the "result" phase is
  // entered. Best-effort: the profile BadgeGrid is the source of truth, so a
  // missed snapshot (still loading) just skips the toast — cosmetic only.
  const badgeSnapshotRef = useRef<Set<string> | null>(null);
  const badgeToastedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    badgeSnapshotRef.current = null;
    badgeToastedRef.current = false;
    getBadges()
      .then((badges) => {
        if (!alive) return;
        badgeSnapshotRef.current = new Set(badges.filter((b) => b.earned).map((b) => b.code));
      })
      .catch(() => {
        // best-effort — no snapshot means the result-phase diff below skips too
      });
    return () => {
      alive = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (state.phase !== "result") return;
    if (badgeToastedRef.current) return;
    const before = badgeSnapshotRef.current;
    if (before === null) return; // snapshot never loaded in time — cosmetic miss
    badgeToastedRef.current = true;
    getBadges()
      .then((badges) => {
        for (const b of badges) {
          if (b.earned && !before.has(b.code)) toast(`Бейдж получен: ${b.title}`, "success");
        }
      })
      .catch(() => {
        // best-effort — profile BadgeGrid remains the source of truth
      });
  }, [state.phase]);

  const socket = useDuelSocket(state.roomId, state.sessionToken, state.yourSlot, dispatch);

  const onRematch = async (): Promise<void> => {
    if (!state.roomId) return;
    setRematchBusy(true);
    setRematchError(null);
    try {
      const created = await rematch(state.roomId);
      saveDuelSessionToken(created.room_id, created.session_token);
      navigate(`/duel/${created.room_id}`, { state: { joinUrl: created.join_url } });
    } catch {
      setRematchError("Не удалось создать реванш. Попробуй ещё раз.");
    } finally {
      setRematchBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-sans text-h2 text-ink">Дуэль</h2>
        <Link to="/" className="font-sans text-body font-bold text-primary no-underline">
          ← На главную
        </Link>
      </div>

      {state.phase === "result" && state.result && state.yourSlot ? (
        <DuelResult
          result={state.result}
          yourSlot={state.yourSlot}
          onRematch={() => void onRematch()}
          rematchBusy={rematchBusy}
          rematchError={rematchError}
        />
      ) : (
        <DuelRoom state={state} dispatch={dispatch} socket={socket} joinUrl={joinUrl} />
      )}
    </div>
  );
}
