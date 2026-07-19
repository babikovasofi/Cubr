// @vitest-environment jsdom
//
// Covers the WS client lifecycle: connect, send join, heartbeat-ping,
// parse incoming frames, auto-reconnect on drop, idempotent close on unmount.
// Uses vitest fake timers for heartbeat and reconnect backoff.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDuelSocket } from "../../src/duel/useDuelSocket";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  sentMessages: unknown[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code: code ?? 1000, reason }));
    }
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateClose(code: number = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
    this.simulateClose();
  }
}

let mockWebSockets: MockWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  mockWebSockets = [];
  vi.useFakeTimers();
  (globalThis as any).WebSocket = class MockWebSocketConstructor {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url: string) {
      const ws = new MockWebSocket(url);
      mockWebSockets.push(ws);
      // Copy properties to this instance
      Object.assign(this, ws);
      return ws as any;
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).WebSocket = originalWebSocket;
});

describe("useDuelSocket", () => {
  it("connects and sends join frame when roomId and sessionToken provided", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    // Simulate WS opening
    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    expect(mockWebSockets[0].sentMessages).toContainEqual({ type: "join" });
    unmount();
  });

  it("does not connect if roomId is null", () => {
    const dispatch = vi.fn();
    renderHook(() => useDuelSocket(null, "token-123", "a", dispatch));

    expect(mockWebSockets.length).toBe(0);
  });

  it("does not connect if sessionToken is null", () => {
    const dispatch = vi.fn();
    renderHook(() => useDuelSocket("room-1", null, "a", dispatch));

    expect(mockWebSockets.length).toBe(0);
  });

  it("sends heartbeat ping at interval", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    // Clear join message
    mockWebSockets[0].sentMessages = [];

    // Advance time by heartbeat interval
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(mockWebSockets[0].sentMessages).toContainEqual({ type: "ping" });
    unmount();
  });

  it("dispatches ws_start when receiving start frame with scramble", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "start",
        scramble: "R U R'",
        event: "333",
        prep_deadline_at: "2026-07-19T10:00:00Z",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ws_start",
      scramble: "R U R'",
      event: "333",
      prepDeadlineAt: "2026-07-19T10:00:00Z",
    });
    unmount();
  });

  it("dispatches room_state when receiving room_state frame", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "room_state",
        phase: "preparing",
        opponent_present: true,
        opponent_phase: "preparing",
        scramble: "R U R'",
        event: "333",
        prep_deadline_at: "2026-07-19T10:00:00Z",
        server_start_at: null,
        result: null,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
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
    unmount();
  });

  it("dispatches opponent_status when receiving status_update for opponent", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "status_update",
        player: "b",
        phase: "ready",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "opponent_status",
      phase: "ready",
    });
    unmount();
  });

  it("drops status_update if player is self (defensive)", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "status_update",
        player: "a", // Same as yourSlot
        phase: "ready",
      });
    });

    // status_update should not be dispatched
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "opponent_status" })
    );
    unmount();
  });

  it("dispatches countdown when receiving countdown frame", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "countdown",
        server_start_at: "2026-07-19T10:03:00Z",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "countdown",
      serverStartAt: "2026-07-19T10:03:00Z",
    });
    unmount();
  });

  it("dispatches result when receiving result frame", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "result",
        players: [
          { slot: "a", time_ms: 5000, status: "valid" },
          { slot: "b", time_ms: 6000, status: "valid" },
        ],
        winner_id: "user-a",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "result",
      payload: {
        players: [
          { slot: "a", time_ms: 5000, status: "valid" },
          { slot: "b", time_ms: 6000, status: "valid" },
        ],
        winner_id: "user-a",
      },
    });
    unmount();
  });

  it("dispatches opponent_left when receiving opponent_left frame", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "opponent_left",
        grace_seconds: 60,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "opponent_left",
      graceSeconds: 60,
    });
    unmount();
  });

  it("ignores pong frames silently", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({ type: "pong" });
    });

    // No dispatch call for pong
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pong" })
    );
    unmount();
  });

  it("dispatches room_not_found error when receiving error frame with room_not_found code", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "error",
        code: "room_not_found",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({ type: "room_not_found" });
    unmount();
  });

  it("dispatches duel_already_active error frame", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      mockWebSockets[0]?.simulateMessage({
        type: "error",
        code: "duel_already_active",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "duel_already_active",
      existingRoomId: null,
    });
    unmount();
  });

  it("ignores malformed JSON frames", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
      // Simulate a message event with invalid JSON
      if (mockWebSockets[0].onmessage) {
        mockWebSockets[0].onmessage(new MessageEvent("message", { data: "not-json" }));
      }
    });

    // Should not crash, dispatch should not be called for the malformed frame
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "not-json" })
    );
    unmount();
  });

  it("reconnects on unexpected close (not 4401/4403)", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    expect(mockWebSockets.length).toBe(1);

    // Simulate unexpected close with code 1000 (normal)
    await act(async () => {
      mockWebSockets[0]?.simulateClose(1000);
    });

    // Should dispatch disconnected
    expect(dispatch).toHaveBeenCalledWith({ type: "disconnected" });

    // Advance timers to trigger reconnect
    await act(async () => {
      vi.advanceTimersByTime(1_000); // RECONNECT_BASE_MS
    });

    // Should have created a new WS connection
    expect(mockWebSockets.length).toBe(2);

    // Simulate the new connection opening
    await act(async () => {
      mockWebSockets[1]?.simulateOpen();
    });

    // Should send join on reconnect
    expect(mockWebSockets[1].sentMessages).toContainEqual({ type: "join" });

    unmount();
  });

  it("does not reconnect on fatal close codes (4401, 4403)", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    // Close with 4401 (bad session_token)
    await act(async () => {
      mockWebSockets[0]?.simulateClose(4401);
    });

    // Dispatch disconnected
    expect(dispatch).toHaveBeenCalledWith({ type: "disconnected" });

    // Advance time
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // Should not have reconnected
    expect(mockWebSockets.length).toBe(1);

    unmount();
  });

  it("unmount closes idempotently (StrictMode-safe)", async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    const closeSpy = vi.spyOn(mockWebSockets[0], "close");

    // First unmount
    await act(async () => {
      unmount();
    });

    expect(closeSpy).toHaveBeenCalledWith(1000, "unmount");

    // After unmount, further closes should be no-ops (already closed)
    expect(mockWebSockets[0].readyState).toBe(MockWebSocket.CLOSED);

    closeSpy.mockRestore();
  });

  it("provides sendStatusUpdate API", async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    mockWebSockets[0].sentMessages = []; // Clear join

    await act(async () => {
      result.current.sendStatusUpdate("ready");
    });

    expect(mockWebSockets[0].sentMessages).toContainEqual({
      type: "status_update",
      phase: "ready",
    });
  });

  it("provides sendFinish API with time_ms rounded", async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    mockWebSockets[0].sentMessages = [];

    await act(async () => {
      result.current.sendFinish({
        elapsedMs: 5000.7,
        dnf: false,
        cameraVerified: true,
      });
    });

    expect(mockWebSockets[0].sentMessages).toContainEqual({
      type: "finish",
      time_ms: 5001, // Rounded
      dnf: false,
      verify_frames_ok: true,
    });
  });

  it("sendFinish enforces minimum time_ms of 1", async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    mockWebSockets[0].sentMessages = [];

    await act(async () => {
      result.current.sendFinish({
        elapsedMs: 0.3,
        dnf: true,
        cameraVerified: false,
      });
    });

    expect(mockWebSockets[0].sentMessages).toContainEqual({
      type: "finish",
      time_ms: 1, // Min of 1
      dnf: true,
      verify_frames_ok: false,
    });
  });

  it("does not send when WS is not open", async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useDuelSocket("room-1", "token-123", "a", dispatch)
    );

    // Don't simulate open, so WS stays in CONNECTING state

    mockWebSockets[0].sentMessages = [];

    await act(async () => {
      result.current.sendStatusUpdate("ready");
    });

    // Should not send since WS is not OPEN
    expect(mockWebSockets[0].sentMessages.length).toBe(0);
  });

  it("changes roomId/sessionToken triggers reconnect", async () => {
    const dispatch = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ roomId, token }) => useDuelSocket(roomId, token, "a", dispatch),
      { initialProps: { roomId: "room-1", token: "token-123" } }
    );

    await act(async () => {
      mockWebSockets[0]?.simulateOpen();
    });

    expect(mockWebSockets.length).toBe(1);

    // Change roomId/token
    await act(async () => {
      rerender({ roomId: "room-2", token: "token-456" });
    });

    // Should have closed old and opened new
    expect(mockWebSockets[0].readyState).toBe(MockWebSocket.CLOSED);
    expect(mockWebSockets.length).toBe(2);

    await act(async () => {
      mockWebSockets[1]?.simulateOpen();
    });

    expect(mockWebSockets[1].url).toContain("room-2");

    unmount();
  });
});
