// @vitest-environment jsdom
//
// Covers all state machine transitions and error cases. Pure reducer — no
// DOM, no sockets, no timers. Fully unit-testable. Driven by REST bootstrap
// (bootstrap_ok) and WS events (ws_start, status_update, etc.).

import { describe, it, expect } from "vitest";
import {
  duelReducer,
  initialDuelState,
  fallbackPhaseFromRoomStatus,
  ritualPhaseToWire,
  type DuelMachineState,
} from "../../src/duel/duelMachine";
import type { DuelRoomRead } from "../../src/api/duel";

const NO_OPPONENT = {
  opponent_display_name: null,
  opponent_avatar_url: null,
  opponent_cups: null,
  opponent_cups_rank: null,
};

const ROOM_OPEN: DuelRoomRead = {
  room_id: "room-1",
  status: "open",
  mode: "fast",
  event: "333",
  your_slot: "a",
  opponent_present: false,
  ...NO_OPPONENT,
};

const ROOM_FULL: DuelRoomRead = {
  room_id: "room-1",
  status: "full",
  mode: "fast",
  event: "333",
  your_slot: "a",
  opponent_present: true,
  ...NO_OPPONENT,
};

describe("duelMachine — fallbackPhaseFromRoomStatus", () => {
  it("maps 'open' and 'full' to waiting_opponent", () => {
    expect(fallbackPhaseFromRoomStatus("open")).toBe("waiting_opponent");
    expect(fallbackPhaseFromRoomStatus("full")).toBe("waiting_opponent");
  });

  it("maps 'active' to preparing", () => {
    expect(fallbackPhaseFromRoomStatus("active")).toBe("preparing");
  });

  it("maps 'finished' to result", () => {
    expect(fallbackPhaseFromRoomStatus("finished")).toBe("result");
  });

  it("maps 'abandoned' to opponent_left", () => {
    expect(fallbackPhaseFromRoomStatus("abandoned")).toBe("opponent_left");
  });
});

describe("duelMachine — ritualPhaseToWire", () => {
  it("maps loading/calibrate/walkthrough/verify to preparing", () => {
    expect(ritualPhaseToWire("loading")).toBe("preparing");
    expect(ritualPhaseToWire("calibrate")).toBe("preparing");
    expect(ritualPhaseToWire("walkthrough")).toBe("preparing");
    expect(ritualPhaseToWire("verify")).toBe("preparing");
  });

  it("maps armed to ready", () => {
    expect(ritualPhaseToWire("armed")).toBe("ready");
  });

  it("maps solving/stopped/solve_verify to solving", () => {
    expect(ritualPhaseToWire("solving")).toBe("solving");
    expect(ritualPhaseToWire("stopped")).toBe("solving");
    expect(ritualPhaseToWire("solve_verify")).toBe("solving");
  });

  it("maps result to finished", () => {
    expect(ritualPhaseToWire("result")).toBe("finished");
  });
});

describe("duelMachine — reducer transitions", () => {
  it("starts in 'connecting' phase", () => {
    expect(initialDuelState.phase).toBe("connecting");
  });

  it("connect_start sets phase to connecting and clears error", () => {
    const state = { ...initialDuelState, error: "some error" };
    const next = duelReducer(state, { type: "connect_start" });
    expect(next.phase).toBe("connecting");
    expect(next.error).toBeNull();
  });

  it("bootstrap_ok sets roomId/sessionToken/event/yourSlot/opponentPresent and uses fallback phase", () => {
    const state = initialDuelState;
    const next = duelReducer(state, {
      type: "bootstrap_ok",
      room: ROOM_OPEN,
      sessionToken: "token-123",
    });
    expect(next.roomId).toBe("room-1");
    expect(next.sessionToken).toBe("token-123");
    expect(next.event).toBe("333");
    expect(next.yourSlot).toBe("a");
    expect(next.opponentPresent).toBe(false);
    expect(next.phase).toBe("waiting_opponent"); // fallback from status=open
    expect(next.error).toBeNull();
  });

  it("bootstrap_ok with full room sets opponentPresent=true", () => {
    const next = duelReducer(initialDuelState, {
      type: "bootstrap_ok",
      room: ROOM_FULL,
      sessionToken: "token-123",
    });
    expect(next.opponentPresent).toBe(true);
    expect(next.phase).toBe("waiting_opponent");
  });

  it("room_not_found resets to terminal phase", () => {
    const state = { ...initialDuelState, phase: "connecting" as const };
    const next = duelReducer(state, { type: "room_not_found" });
    expect(next.phase).toBe("room_not_found");
    expect(next.roomId).toBeNull();
  });

  it("duel_already_active sets phase and carries existingRoomId", () => {
    const state = initialDuelState;
    const next = duelReducer(state, {
      type: "duel_already_active",
      existingRoomId: "existing-room-123",
    });
    expect(next.phase).toBe("duel_already_active");
    expect(next.existingRoomId).toBe("existing-room-123");
    expect(next.roomId).toBeNull();
  });

  it("duel_already_active with null existingRoomId is allowed", () => {
    const next = duelReducer(initialDuelState, {
      type: "duel_already_active",
      existingRoomId: null,
    });
    expect(next.phase).toBe("duel_already_active");
    expect(next.existingRoomId).toBeNull();
  });

  it("ws_room_state overrides phase and updates snapshot fields", () => {
    const state = {
      ...initialDuelState,
      roomId: "room-1",
      phase: "waiting_opponent" as const,
      opponentPresent: false,
      scramble: null,
    };
    const next = duelReducer(state, {
      type: "ws_room_state",
      phase: "preparing",
      opponentPresent: true,
      opponentPhase: "preparing",
      scramble: "R U R'",
      event: "333",
      prepDeadlineAt: "2026-07-19T10:00:00Z",
      serverStartAt: null,
      result: null,
    });
    expect(next.phase).toBe("preparing");
    expect(next.opponentPresent).toBe(true);
    expect(next.opponentPhase).toBe("preparing");
    expect(next.scramble).toBe("R U R'");
    expect(next.prepDeadlineAt).toBe("2026-07-19T10:00:00Z");
    expect(next.error).toBeNull();
  });

  it("ws_room_state preserves existing scramble if new one is null", () => {
    const state = {
      ...initialDuelState,
      scramble: "old-scramble",
    };
    const next = duelReducer(state, {
      type: "ws_room_state",
      phase: "countdown",
      opponentPresent: true,
      opponentPhase: "ready",
      scramble: null,
      event: null,
      prepDeadlineAt: null,
      serverStartAt: "2026-07-19T10:03:00Z",
      result: null,
    });
    expect(next.scramble).toBe("old-scramble");
    expect(next.serverStartAt).toBe("2026-07-19T10:03:00Z");
  });

  it("ws_start reveals scramble and moves to preparing", () => {
    const state = { ...initialDuelState, phase: "waiting_opponent" as const };
    const next = duelReducer(state, {
      type: "ws_start",
      scramble: "R U R'",
      event: "333",
      prepDeadlineAt: "2026-07-19T10:00:00Z",
    });
    expect(next.phase).toBe("preparing");
    expect(next.scramble).toBe("R U R'");
    expect(next.event).toBe("333");
    expect(next.prepDeadlineAt).toBe("2026-07-19T10:00:00Z");
    expect(next.opponentPresent).toBe(true);
    expect(next.error).toBeNull();
  });

  it("opponent_status updates opponentPhase without changing phase", () => {
    const state = { ...initialDuelState, phase: "preparing" as const };
    const next = duelReducer(state, { type: "opponent_status", phase: "ready" });
    expect(next.opponentPhase).toBe("ready");
    expect(next.phase).toBe("preparing");
  });

  it("self_ready advances from preparing to ready_wait", () => {
    const state = { ...initialDuelState, phase: "preparing" as const };
    const next = duelReducer(state, { type: "self_ready" });
    expect(next.phase).toBe("ready_wait");
  });

  it("self_ready is idempotent — second call stays in ready_wait", () => {
    let state: DuelMachineState = { ...initialDuelState, phase: "preparing" };
    state = duelReducer(state, { type: "self_ready" });
    expect(state.phase).toBe("ready_wait");

    // Second ready_wait call (StrictMode re-render) must not regress
    const next = duelReducer(state, { type: "self_ready" });
    expect(next.phase).toBe("ready_wait");
  });

  it("self_ready from non-preparing phase is no-op", () => {
    const state = { ...initialDuelState, phase: "waiting_opponent" as const };
    const next = duelReducer(state, { type: "self_ready" });
    expect(next.phase).toBe("waiting_opponent");
  });

  it("countdown moves to countdown phase and stores serverStartAt", () => {
    const state = { ...initialDuelState, phase: "ready_wait" as const };
    const next = duelReducer(state, {
      type: "countdown",
      serverStartAt: "2026-07-19T10:03:00Z",
    });
    expect(next.phase).toBe("countdown");
    expect(next.serverStartAt).toBe("2026-07-19T10:03:00Z");
  });

  it("solving_start advances from countdown to solving", () => {
    const state = { ...initialDuelState, phase: "countdown" as const };
    const next = duelReducer(state, { type: "solving_start" });
    expect(next.phase).toBe("solving");
  });

  it("solving_start from non-countdown phase is no-op", () => {
    const state = { ...initialDuelState, phase: "preparing" as const };
    const next = duelReducer(state, { type: "solving_start" });
    expect(next.phase).toBe("preparing");
  });

  it("self_finished records ownResult and moves to finished (not in result)", () => {
    const state = { ...initialDuelState, phase: "solving" as const };
    const result = { elapsedMs: 5000, dnf: false, cameraVerified: true };
    const next = duelReducer(state, { type: "self_finished", result });
    expect(next.phase).toBe("finished");
    expect(next.ownResult).toEqual(result);
  });

  it("self_finished while in result phase is ignored", () => {
    const state = {
      ...initialDuelState,
      phase: "result" as const,
      ownResult: null,
    };
    const result = { elapsedMs: 5000, dnf: false, cameraVerified: true };
    const next = duelReducer(state, { type: "self_finished", result });
    expect(next.phase).toBe("result");
    expect(next.ownResult).toBeNull();
  });

  it("result moves to result phase and stores payload", () => {
    const state = { ...initialDuelState, phase: "finished" as const };
    const payload = {
      players: [
        { slot: "a" as const, time_ms: 5000, status: "valid" as const },
        { slot: "b" as const, time_ms: 6000, status: "valid" as const },
      ],
      winner_id: "user-a",
    };
    const next = duelReducer(state, { type: "result", payload });
    expect(next.phase).toBe("result");
    expect(next.result).toEqual(payload);
  });

  it("opponent_left moves to opponent_left phase (if not already in result)", () => {
    const state = { ...initialDuelState, phase: "preparing" as const };
    const next = duelReducer(state, { type: "opponent_left", graceSeconds: 60 });
    expect(next.phase).toBe("opponent_left");
    expect(next.graceSeconds).toBe(60);
  });

  it("opponent_left while in result phase is ignored", () => {
    const state = {
      ...initialDuelState,
      phase: "result" as const,
      graceSeconds: null,
    };
    const next = duelReducer(state, { type: "opponent_left", graceSeconds: 60 });
    expect(next.phase).toBe("result");
    expect(next.graceSeconds).toBeNull();
  });

  it("disconnected moves to disconnected phase (if not already in result)", () => {
    const state = { ...initialDuelState, phase: "solving" as const };
    const next = duelReducer(state, { type: "disconnected" });
    expect(next.phase).toBe("disconnected");
  });

  it("disconnected while in result phase is ignored", () => {
    const state = { ...initialDuelState, phase: "result" as const };
    const next = duelReducer(state, { type: "disconnected" });
    expect(next.phase).toBe("result");
  });
});

describe("duelMachine — full transition sequence", () => {
  it("traces connecting → waiting_opponent → preparing → ready_wait → countdown → solving → finished → result", () => {
    let s = initialDuelState;
    expect(s.phase).toBe("connecting");

    // Bootstrap
    s = duelReducer(s, {
      type: "bootstrap_ok",
      room: ROOM_OPEN,
      sessionToken: "token",
    });
    expect(s.phase).toBe("waiting_opponent");

    // WS start (both players present)
    s = duelReducer(s, {
      type: "ws_start",
      scramble: "R U R'",
      event: "333",
      prepDeadlineAt: "2026-07-19T10:00:00Z",
    });
    expect(s.phase).toBe("preparing");
    expect(s.scramble).toBe("R U R'");

    // Player marks as ready
    s = duelReducer(s, { type: "self_ready" });
    expect(s.phase).toBe("ready_wait");

    // Both ready, server sends countdown
    s = duelReducer(s, {
      type: "countdown",
      serverStartAt: "2026-07-19T10:03:00Z",
    });
    expect(s.phase).toBe("countdown");

    // Overlay expires, solving starts
    s = duelReducer(s, { type: "solving_start" });
    expect(s.phase).toBe("solving");

    // Player finishes
    s = duelReducer(s, {
      type: "self_finished",
      result: { elapsedMs: 5000, dnf: false, cameraVerified: true },
    });
    expect(s.phase).toBe("finished");
    expect(s.ownResult?.elapsedMs).toBe(5000);

    // Result from server
    s = duelReducer(s, {
      type: "result",
      payload: {
        players: [
          { slot: "a", time_ms: 5000, status: "valid" },
          { slot: "b", time_ms: 6000, status: "valid" },
        ],
        winner_id: "user-a",
      },
    });
    expect(s.phase).toBe("result");
    expect(s.result?.winner_id).toBe("user-a");
  });
});
