// Duel WS client (plan: stage4-duel-by-link). Owns the socket lifecycle:
// connect -> send `join` for the snapshot -> heartbeat-ping -> parse incoming
// frames into duelMachine actions -> auto-reconnect with backoff on an
// unexpected drop, keyed on the SAME (room_id, session_token) the caller
// passed in (the token is HMAC-signed server-side and survives a reconnect —
// see api/duel.ts wsUrl / plan services/duel_token.py).
//
// StrictMode-safe: the connect effect's cleanup always runs (mount, then the
// double-invoke cleanup+remount in dev, then real unmount) and each cleanup
// marks `closedByUsRef` before calling ws.close() — the onclose handler reads
// that flag to distinguish "we tore this down on purpose" (unmount, or a
// dep change) from "the connection actually dropped" and only reconnects for
// the latter. ws.close() is a no-op on an already-closed/closing socket, so a
// double cleanup is safe.
//
// CONTRACT ASSUMPTIONS (docs/ws-protocol.md not finalized as of writing —
// backend agent authors it in parallel; reconcile if these drift):
// - Every incoming frame is `{ type: string, ...fields }`, fields snake_case
//   (matches this codebase's existing wire convention, e.g. week_label,
//   deadline_at, time_ms).
// - `room_state` carries an explicit `phase` field using duelMachine's
//   DuelPhase vocabulary (see duelMachine.ts's top comment) — the server is
//   the source of truth for phase on connect/reconnect, not re-derived here.
// - `join` is sent by the client once the socket opens (both first connect
//   and every reconnect) to request that `room_state` snapshot; the server
//   does not push it unprompted.
// - Close codes 4401 (bad/missing session_token) and 4403 (Origin not
//   allow-listed) are fatal per the plan's WS-auth section — never retried.
// - `status_update` echoes `{player, phase}`; frames where `player` equals
//   the caller's OWN slot are dropped (defensive — should not happen since
//   the server presumably only broadcasts the opponent's change to us, but
//   nothing in the plan text rules out an echo-back).

import { useEffect, useRef, type Dispatch } from "react";
import { wsUrl } from "../api/duel";
import type {
  DuelAction,
  DuelPhase,
  DuelPlayerResult,
  PlayerRitualPhase,
  PlayerSlot,
  RitualOutcome,
} from "./duelMachine";

// Must stay well under the server's DUEL_HEARTBEAT_TIMEOUT_SECONDS (15s): the
// server force-disconnects any socket silent longer than that, so an idle
// client (e.g. the creator waiting for an opponent, or a player lingering in
// prep) has to ping more often than the timeout or it gets dropped every 15s.
const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
const FATAL_CLOSE_CODES = new Set([4401, 4403]);

interface WireRoomState {
  type: "room_state";
  phase: DuelPhase;
  opponent_present: boolean;
  opponent_phase: PlayerRitualPhase | null;
  scramble: string | null;
  event: string | null;
  prep_deadline_at: string | null;
  server_start_at: string | null;
  result: { players: DuelPlayerResult[]; winner_id: string | null } | null;
}

interface WireStart {
  type: "start";
  scramble: string;
  event: string;
  prep_deadline_at: string | null;
}

interface WireStatusUpdate {
  type: "status_update";
  player: PlayerSlot;
  phase: PlayerRitualPhase;
}

interface WireCountdown {
  type: "countdown";
  server_start_at: string;
}

interface WireResult {
  type: "result";
  players: DuelPlayerResult[];
  winner_id: string | null;
}

interface WireOpponentLeft {
  type: "opponent_left";
  grace_seconds: number;
}

interface WirePong {
  type: "pong";
}

interface WireError {
  type: "error";
  code: string;
}

type WireMessage =
  | WireRoomState
  | WireStart
  | WireStatusUpdate
  | WireCountdown
  | WireResult
  | WireOpponentLeft
  | WirePong
  | WireError;

function isWireMessage(v: unknown): v is WireMessage {
  return !!v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string";
}

function handleMessage(
  msg: WireMessage,
  dispatch: Dispatch<DuelAction>,
  yourSlot: PlayerSlot | null,
): void {
  switch (msg.type) {
    case "room_state":
      dispatch({
        type: "ws_room_state",
        phase: msg.phase,
        opponentPresent: msg.opponent_present,
        opponentPhase: msg.opponent_phase,
        scramble: msg.scramble,
        event: msg.event,
        prepDeadlineAt: msg.prep_deadline_at,
        serverStartAt: msg.server_start_at,
        result: msg.result,
      });
      return;
    case "start":
      dispatch({
        type: "ws_start",
        scramble: msg.scramble,
        event: msg.event,
        prepDeadlineAt: msg.prep_deadline_at,
      });
      return;
    case "status_update":
      if (yourSlot === null || msg.player !== yourSlot) {
        dispatch({ type: "opponent_status", phase: msg.phase });
      }
      return;
    case "countdown":
      dispatch({ type: "countdown", serverStartAt: msg.server_start_at });
      return;
    case "result":
      dispatch({ type: "result", payload: { players: msg.players, winner_id: msg.winner_id } });
      return;
    case "opponent_left":
      dispatch({ type: "opponent_left", graceSeconds: msg.grace_seconds });
      return;
    case "pong":
      return;
    case "error":
      if (msg.code === "room_not_found") {
        dispatch({ type: "room_not_found" });
      } else if (msg.code === "duel_already_active") {
        dispatch({ type: "duel_already_active", existingRoomId: null });
      }
      return;
  }
}

export interface DuelSocketApi {
  sendStatusUpdate: (phase: PlayerRitualPhase) => void;
  sendFinish: (result: RitualOutcome) => void;
}

export function useDuelSocket(
  roomId: string | null,
  sessionToken: string | null,
  yourSlot: PlayerSlot | null,
  dispatch: Dispatch<DuelAction>,
): DuelSocketApi {
  const wsRef = useRef<WebSocket | null>(null);

  // Latest values for callbacks captured once inside the connect effect — kept
  // in refs so status_update filtering / dispatch always see the current
  // props without re-running the connect effect (and therefore reopening the
  // socket) on every render.
  const slotRef = useRef(yourSlot);
  slotRef.current = yourSlot;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    if (!roomId || !sessionToken) return;
    const rid = roomId;
    const token = sessionToken;

    let closedByUs = false;
    let fatal = false;
    let attempt = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function clearHeartbeat(): void {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function clearReconnect(): void {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(): void {
      if (fatal) return;
      clearReconnect();
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect(): void {
      const ws = new WebSocket(wsUrl(rid, token));
      wsRef.current = ws;
      closedByUs = false;

      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify({ type: "join" }));
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          return; // malformed frame — ignore, do not tear down the connection
        }
        if (isWireMessage(parsed)) handleMessage(parsed, dispatchRef.current, slotRef.current);
      };

      ws.onclose = (ev: CloseEvent) => {
        clearHeartbeat();
        if (closedByUs) return; // deliberate close (unmount/dep change) — no reconnect
        dispatchRef.current({ type: "disconnected" });
        if (FATAL_CLOSE_CODES.has(ev.code)) {
          fatal = true;
          return;
        }
        scheduleReconnect();
      };

      // onerror is always followed by onclose for a browser WebSocket — the
      // reconnect/dispatch decision lives there, this is just quiet-by-design.
      ws.onerror = () => {};
    }

    connect();

    return () => {
      closedByUs = true;
      fatal = true; // no pending reconnect should fire after this effect tears down
      clearHeartbeat();
      clearReconnect();
      wsRef.current?.close(1000, "unmount");
      wsRef.current = null;
    };
  }, [roomId, sessionToken]);

  const send = (payload: unknown): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  return {
    sendStatusUpdate: (phase) => send({ type: "status_update", phase }),
    sendFinish: (result) =>
      send({
        type: "finish",
        time_ms: Math.max(1, Math.round(result.elapsedMs)),
        dnf: result.dnf,
        verify_frames_ok: result.cameraVerified,
      }),
  };
}
