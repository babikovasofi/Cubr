// @vitest-environment jsdom
//
// Covers the duel room component: opponent status panel, countdown overlay,
// error affordances (duel_already_active). Uses RTL and mocks useSoloSession,
// SolveRitual, and the socket API.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import DuelRoom from "../../src/duel/DuelRoom";
import type { DuelMachineState } from "../../src/duel/duelMachine";
import type { DuelSocketApi } from "../../src/duel/useDuelSocket";

const { useSoloSessionMock } = vi.hoisted(() => ({
  useSoloSessionMock: vi.fn(),
}));

vi.mock("../../src/solo/useSoloSession", () => ({
  useSoloSession: useSoloSessionMock,
}));

// Mock SolveRitual component to avoid rendering complex camera/timer UI
vi.mock("../../src/solo/SolveRitual", () => ({
  default: ({ s }: { s: any }) => (
    <div data-testid="solve-ritual">Solve Ritual: {s.state.phase}</div>
  ),
}));

const DEFAULT_STATE: DuelMachineState = {
  phase: "preparing",
  roomId: "room-1",
  sessionToken: "token-123",
  event: "333",
  yourSlot: "a",
  opponentPresent: true,
  opponentPhase: "preparing",
  scramble: "R U R'",
  prepDeadlineAt: "2026-07-19T10:00:00Z",
  serverStartAt: null,
  ownResult: null,
  result: null,
  existingRoomId: null,
  graceSeconds: null,
  error: null,
};

const DEFAULT_SOCKET: DuelSocketApi = {
  sendStatusUpdate: vi.fn(),
  sendFinish: vi.fn(),
};

const DEFAULT_DISPATCH = vi.fn();

beforeEach(() => {
  useSoloSessionMock.mockReset();
  DEFAULT_DISPATCH.mockReset();
  useSoloSessionMock.mockReturnValue({
    state: {
      phase: "armed",
      startedAtMs: Date.now(),
    },
  });
});

const renderWithRouter = (element: React.ReactElement) => {
  return render(<BrowserRouter>{element}</BrowserRouter>);
};

describe("DuelRoom", () => {
  it("renders waiting card when phase is waiting_opponent", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "waiting_opponent",
      scramble: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText("Жду соперника")).toBeTruthy();
    expect(screen.getByText(/Соперник ещё не подключился/)).toBeTruthy();
  });

  it("renders invite panel when phase is waiting_opponent and joinUrl provided", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "waiting_opponent",
      scramble: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl="https://example.com/duel/join/token-abc"
      />
    );

    // InvitePanel should render with the URL
    expect(screen.getByText(/https:\/\/example.com\/duel\/join\/token-abc/)).toBeTruthy();
  });

  it("renders not found card when phase is room_not_found", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "room_not_found",
      scramble: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(
      screen.getByText(/Такой дуэли не существует/)
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "На главную" })).toBeTruthy();
  });

  it("renders duel_already_active card with reconnect button when existingRoomId present", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "duel_already_active",
      scramble: null,
      existingRoomId: "existing-room-123",
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(
      screen.getByText(/У тебя уже есть активная дуэль/)
    ).toBeTruthy();
    const button = screen.getByRole("link", { name: "Перейти к активной дуэли" });
    expect(button).toBeTruthy();
    expect(button.getAttribute("href")).toBe("/duel/existing-room-123");
  });

  it("renders duel_already_active card with home link when existingRoomId is null", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "duel_already_active",
      scramble: null,
      existingRoomId: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(
      screen.getByText(/У тебя уже есть активная дуэль/)
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "На главную" })).toBeTruthy();
  });

  it("renders ActiveRitual when scramble is not null", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "preparing",
      scramble: "R U R'",
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByTestId("solve-ritual")).toBeTruthy();
  });

  it("does not render ActiveRitual when scramble is null", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "preparing",
      scramble: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.queryByTestId("solve-ritual")).toBeNull();
  });

  it("renders CountdownOverlay when phase is countdown and serverStartAt is set", async () => {
    const now = new Date();
    const futureTime = new Date(now.getTime() + 3_000); // 3 seconds from now

    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "countdown",
      scramble: "R U R'",
      serverStartAt: futureTime.toISOString(),
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // CountdownOverlay should be visible
    expect(screen.getByText(/Приготовься/)).toBeTruthy();
    expect(screen.getByText(/камера скрыта до старта/)).toBeTruthy();
  });

  it("calls onElapsed when countdown expires", async () => {
    const now = Date.now();
    const pastTime = new Date(now - 100); // Already elapsed

    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "countdown",
      scramble: "R U R'",
      serverStartAt: pastTime.toISOString(),
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // Overlay should show "Старт!" for already-elapsed time
    await waitFor(() => {
      expect(screen.getByText("Старт!")).toBeTruthy();
    });

    // Should have dispatched solving_start
    await waitFor(() => {
      expect(DEFAULT_DISPATCH).toHaveBeenCalledWith({ type: "solving_start" });
    });
  });

  it("does not render CountdownOverlay when phase is not countdown", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "solving",
      scramble: "R U R'",
      serverStartAt: "2026-07-19T10:03:00Z",
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // Overlay should not be present
    expect(screen.queryByText(/Приготовься/)).toBeNull();
  });

  it("renders ReadyWaitBanner when phase is ready_wait", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "ready_wait",
      scramble: "R U R'",
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText(/Готов\. Жду соперника/)).toBeTruthy();
  });

  it("renders FinishedWaitBanner when phase is finished", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "finished",
      scramble: "R U R'",
      ownResult: { elapsedMs: 5000, dnf: false, cameraVerified: true },
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText(/Жду результат соперника/)).toBeTruthy();
  });

  it("renders OpponentLeftBanner when phase is opponent_left", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "opponent_left",
      scramble: "R U R'",
      graceSeconds: 45,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText(/Соперник отключился/)).toBeTruthy();
    expect(screen.getByText(/Жду его возвращения ещё 45 с/)).toBeTruthy();
  });

  it("renders OpponentLeftBanner with generic message when graceSeconds is null", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "opponent_left",
      scramble: "R U R'",
      graceSeconds: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText(/Соперник отключился/)).toBeTruthy();
    expect(
      screen.getByText(/Жду его возвращения — если не вернётся/)
    ).toBeTruthy();
  });

  it("renders DisconnectedBanner when phase is disconnected", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "disconnected",
      scramble: "R U R'",
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    expect(screen.getByText(/Связь потеряна/)).toBeTruthy();
    expect(screen.getByText(/Переподключаюсь/)).toBeTruthy();
  });

  it("renders ritual even with phase=result if scramble exists (though DuelPage renders DuelResult instead)", () => {
    // Note: In practice, DuelPage renders DuelResult for phase="result", not DuelRoom.
    // This test documents that IF DuelRoom were rendered with phase="result",
    // it would still show the ritual (since showRitual is based on scramble, not phase).
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "result",
      scramble: "R U R'",
      ownResult: { elapsedMs: 5000, dnf: false, cameraVerified: true },
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // Ritual is shown because scramble is not null
    expect(screen.getByTestId("solve-ritual")).toBeTruthy();
  });

  it("opponent_left banner still shows ritual underneath (layered UI)", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "opponent_left",
      scramble: "R U R'",
      graceSeconds: 30,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // Both banner and ritual should be present
    expect(screen.getByText(/Соперник отключился/)).toBeTruthy();
    expect(screen.getByTestId("solve-ritual")).toBeTruthy();
  });

  it("renders connecting spinner when phase is connecting", () => {
    const state: DuelMachineState = {
      ...DEFAULT_STATE,
      phase: "connecting",
      scramble: null,
      roomId: null,
    };

    renderWithRouter(
      <DuelRoom
        state={state}
        dispatch={DEFAULT_DISPATCH}
        socket={DEFAULT_SOCKET}
        joinUrl={null}
      />
    );

    // Text appears twice (visible + sr-only), use getAllByText
    expect(screen.getAllByText(/Подключаюсь к комнате/).length).toBeGreaterThan(0);
  });
});
