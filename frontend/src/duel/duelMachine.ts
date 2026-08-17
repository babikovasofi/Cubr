// Duel-by-link ritual state machine (plan: stage4-duel-by-link, образец
// tournament/useTournamentAttempt.ts). Pure reducer — no DOM, no sockets, no
// timers — fully unit-testable. Driven by two sources: REST bootstrap
// (DuelPage's getRoom) and WS events (useDuelSocket.ts).
//
// Phases: connecting -> waiting_opponent -> preparing -> ready_wait ->
// countdown -> solving -> finished -> result, plus terminal error-phases
// duel_already_active (carries existing_room_id, П11) / opponent_left /
// disconnected / room_not_found.
//
// CONTRACT ASSUMPTION (flagged for backend reconciliation, docs/ws-protocol.md
// was not yet written when this was authored): the WS `room_state` snapshot
// carries an explicit `phase` field using THIS SAME phase vocabulary (minus
// "connecting", "duel_already_active", "room_not_found" — those only ever
// arise client-side from REST). This lets the server be the single source of
// truth for "where are we" on both initial connect AND reconnect, instead of
// the client re-deriving phase from room status + timestamps. If the backend
// instead sends only a bare room `status` (open|full|active|finished|
// abandoned) without a `phase` field, `useDuelSocket.ts` is the one file that
// needs to change (map status -> DuelPhase there) — this reducer's action
// shape stays the same.
//
// honesty is never surfaced here (self-reported, server always returns
// "pending") and no cups/rating field exists on this state — Stage 4
// excludes both, see plan "Out of scope".

import type { DuelRoomRead, DuelRoomStatus } from "../api/duel";

export type DuelPhase =
  | "connecting"
  | "waiting_opponent"
  | "preparing"
  | "ready_wait"
  | "countdown"
  | "solving"
  | "finished"
  | "result"
  | "duel_already_active"
  | "opponent_left"
  | "disconnected"
  | "room_not_found";

export type PlayerSlot = "a" | "b";

// Sent/received over WS status_update — a coarse ritual phase, NOT the full
// useSoloSession SoloPhase (loading/calibrate/walkthrough/verify/armed/
// solving/stopped/solve_verify/result collapse into these four for the wire).
export type PlayerRitualPhase = "preparing" | "ready" | "solving" | "finished";

export interface RitualOutcome {
  elapsedMs: number;
  dnf: boolean;
  cameraVerified: boolean;
}

export interface DuelPlayerResult {
  slot: PlayerSlot;
  time_ms: number | null;
  status: "pending" | "valid" | "dnf";
}

export interface DuelResultPayload {
  players: DuelPlayerResult[];
  winner_id: string | null; // user id; null = ничья
}

export interface DuelMachineState {
  phase: DuelPhase;
  roomId: string | null;
  sessionToken: string | null;
  event: string | null;
  yourSlot: PlayerSlot | null;
  opponentPresent: boolean;
  opponentPhase: PlayerRitualPhase | null;
  scramble: string | null;
  prepDeadlineAt: string | null;
  serverStartAt: string | null;
  ownResult: RitualOutcome | null;
  result: DuelResultPayload | null;
  existingRoomId: string | null; // duel_already_active only
  graceSeconds: number | null; // opponent_left only
  error: string | null;
}

export type DuelAction =
  | { type: "connect_start" }
  | { type: "bootstrap_ok"; room: DuelRoomRead; sessionToken: string }
  | { type: "room_not_found" }
  | { type: "duel_already_active"; existingRoomId: string | null }
  | {
      type: "ws_room_state";
      phase: DuelPhase;
      opponentPresent: boolean;
      opponentPhase: PlayerRitualPhase | null;
      scramble: string | null;
      event: string | null;
      prepDeadlineAt: string | null;
      serverStartAt: string | null;
      result: DuelResultPayload | null;
    }
  | { type: "ws_start"; scramble: string; event: string; prepDeadlineAt: string | null }
  | { type: "opponent_status"; phase: PlayerRitualPhase }
  | { type: "self_ready" }
  | { type: "countdown"; serverStartAt: string }
  | { type: "solving_start" }
  | { type: "self_finished"; result: RitualOutcome }
  | { type: "result"; payload: DuelResultPayload }
  | { type: "opponent_left"; graceSeconds: number }
  | { type: "disconnected" };

export const initialDuelState: DuelMachineState = {
  phase: "connecting",
  roomId: null,
  sessionToken: null,
  event: null,
  yourSlot: null,
  opponentPresent: false,
  opponentPhase: null,
  scramble: null,
  prepDeadlineAt: null,
  serverStartAt: null,
  ownResult: null,
  result: null,
  existingRoomId: null,
  graceSeconds: null,
  error: null,
};

// Room status without a matching duel phase yet (open/full before the server
// reveals the scramble) reads as "waiting_opponent" — the closest visible
// state, used only as a fallback default if callers construct DuelRoomRead
// without going through ws_room_state.
export function fallbackPhaseFromRoomStatus(status: DuelRoomStatus): DuelPhase {
  switch (status) {
    case "open":
    case "full":
      return "waiting_opponent";
    case "active":
      return "preparing";
    case "finished":
      return "result";
    case "abandoned":
      return "opponent_left";
  }
}

export function duelReducer(s: DuelMachineState, a: DuelAction): DuelMachineState {
  switch (a.type) {
    case "connect_start":
      return { ...s, phase: "connecting", error: null };

    case "bootstrap_ok":
      return {
        ...s,
        roomId: a.room.room_id,
        sessionToken: a.sessionToken,
        event: a.room.event,
        yourSlot: a.room.your_slot,
        opponentPresent: a.room.opponent_present,
        // Best-effort until the WS room_state snapshot lands right after
        // connect and supersedes this with the authoritative phase.
        phase: fallbackPhaseFromRoomStatus(a.room.status),
        error: null,
      };

    case "room_not_found":
      return { ...initialDuelState, phase: "room_not_found" };

    case "duel_already_active":
      return {
        ...initialDuelState,
        phase: "duel_already_active",
        existingRoomId: a.existingRoomId,
      };

    case "ws_room_state":
      return {
        ...s,
        phase: a.phase,
        opponentPresent: a.opponentPresent,
        opponentPhase: a.opponentPhase,
        scramble: a.scramble ?? s.scramble,
        event: a.event ?? s.event,
        prepDeadlineAt: a.prepDeadlineAt ?? s.prepDeadlineAt,
        serverStartAt: a.serverStartAt ?? s.serverStartAt,
        result: a.result ?? s.result,
        error: null,
      };

    case "ws_start":
      return {
        ...s,
        phase: "preparing",
        scramble: a.scramble,
        event: a.event,
        prepDeadlineAt: a.prepDeadlineAt,
        opponentPresent: true,
        error: null,
      };

    case "opponent_status":
      return { ...s, opponentPhase: a.phase };

    case "self_ready":
      // Idempotent: a second "armed" transition (e.g. StrictMode re-render)
      // must not regress an already-advanced phase back to ready_wait.
      return s.phase === "preparing" ? { ...s, phase: "ready_wait" } : s;

    case "countdown":
      return { ...s, phase: "countdown", serverStartAt: a.serverStartAt };

    case "solving_start":
      return s.phase === "countdown" ? { ...s, phase: "solving" } : s;

    case "self_finished":
      return s.phase === "result" ? s : { ...s, phase: "finished", ownResult: a.result };

    case "result":
      return { ...s, phase: "result", result: a.payload };

    case "opponent_left":
      return s.phase === "result"
        ? s
        : { ...s, phase: "opponent_left", graceSeconds: a.graceSeconds };

    case "disconnected":
      return s.phase === "result" ? s : { ...s, phase: "disconnected" };
  }
}

// Maps a local useSoloSession ritual phase onto the coarse wire vocabulary
// sent as WS status_update. Exported so DuelRoom.tsx and tests share one
// mapping instead of duplicating the switch.
export function ritualPhaseToWire(
  soloPhase:
    | "loading"
    | "calibrate"
    | "walkthrough"
    | "verify"
    | "armed"
    | "solving"
    | "stopped"
    | "solve_verify"
    | "result",
): PlayerRitualPhase {
  switch (soloPhase) {
    case "loading":
    case "calibrate":
    case "walkthrough":
    case "verify":
      return "preparing";
    case "armed":
      return "ready";
    case "solving":
    case "stopped":
    case "solve_verify":
      return "solving";
    case "result":
      return "finished";
  }
}
