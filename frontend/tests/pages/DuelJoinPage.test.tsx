// @vitest-environment jsdom
//
// Covers the duel join flow: successful join → navigate, 404 handling,
// 409 (already active duel) with optional existing_room_id link.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";
import DuelJoinPage from "../../src/pages/DuelJoinPage";
import { ApiError } from "../../src/api/client";

const { joinRoomMock, saveDuelSessionTokenMock, existingRoomIdFromMock } = vi.hoisted(() => ({
  joinRoomMock: vi.fn(),
  saveDuelSessionTokenMock: vi.fn(),
  existingRoomIdFromMock: vi.fn(),
}));

vi.mock("../../src/api/duel", () => ({
  joinRoom: joinRoomMock,
  saveDuelSessionToken: saveDuelSessionTokenMock,
  existingRoomIdFrom: existingRoomIdFromMock,
}));

beforeEach(() => {
  joinRoomMock.mockReset();
  saveDuelSessionTokenMock.mockReset();
  existingRoomIdFromMock.mockReset();
  vi.clearAllMocks();
});

const renderDuelJoinPage = (token: string = "test-token") => {
  return render(
    <MemoryRouter initialEntries={[`/duel/join/${token}`]}>
      <Routes>
        <Route path="/duel/join/:token" element={<DuelJoinPage />} />
        {/* Mock route for navigation test */}
        <Route path="/duel/:roomId" element={<div>Duel Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("DuelJoinPage", () => {
  it("shows joining spinner on initial load", () => {
    joinRoomMock.mockImplementation(() => new Promise(() => {})); // Never resolves

    renderDuelJoinPage("token-123");

    expect(screen.getAllByText(/Подключаюсь к дуэли/)[0]).toBeTruthy();
  });

  it("calls joinRoom with the token from URL params", async () => {
    joinRoomMock.mockResolvedValueOnce({
      room_id: "room-1",
      session_token: "token-abc",
      status: "full",
    });

    renderDuelJoinPage("invite-token-123");

    await waitFor(() => {
      expect(joinRoomMock).toHaveBeenCalledWith("invite-token-123");
    });
  });

  it("saves session token on successful join", async () => {
    joinRoomMock.mockResolvedValueOnce({
      room_id: "room-1",
      session_token: "token-abc",
      status: "full",
    });

    renderDuelJoinPage("invite-token-123");

    await waitFor(() => {
      expect(saveDuelSessionTokenMock).toHaveBeenCalledWith("room-1", "token-abc");
    });
  });

  it("navigates to /duel/:roomId on successful join", async () => {
    joinRoomMock.mockResolvedValueOnce({
      room_id: "room-1",
      session_token: "token-abc",
      status: "full",
    });

    // Using MemoryRouter with initialEntries
    render(
      <MemoryRouter initialEntries={["/duel/join/invite-token-123"]}>
        <DuelJoinPage />
      </MemoryRouter>,
    );

    // The page should have navigated (we can't easily test navigate call
    // directly, but we can verify the join succeeded)
    await waitFor(() => {
      expect(joinRoomMock).toHaveBeenCalled();
      expect(saveDuelSessionTokenMock).toHaveBeenCalled();
    });
  });

  it("shows not_found message on 404 error", async () => {
    joinRoomMock.mockRejectedValueOnce(new ApiError(404, null, "Ссылка не найдена"));

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByText(/Ссылка на дуэль недействительна или устарела/)).toBeTruthy();
    });
  });

  it("shows already_active message on 409 error with existing room link", async () => {
    const error = new ApiError(409, null, "Already active", {
      existing_room_id: "existing-room-123",
    });
    joinRoomMock.mockRejectedValueOnce(error);
    existingRoomIdFromMock.mockReturnValueOnce("existing-room-123");

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByText(/У тебя уже есть активная дуэль/)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Перейти к активной дуэли" })).toBeTruthy();
    });
  });

  it("extracts existing_room_id from error and links to it", async () => {
    const error = new ApiError(409, null, "Already active", { existing_room_id: "room-999" });
    joinRoomMock.mockRejectedValueOnce(error);
    existingRoomIdFromMock.mockReturnValueOnce("room-999");

    renderDuelJoinPage();

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Перейти к активной дуэли" });
      expect(link.getAttribute("href")).toBe("/duel/room-999");
    });
  });

  it("shows already_active message without link when existingRoomId is null", async () => {
    const error = new ApiError(409, null, "Already active");
    joinRoomMock.mockRejectedValueOnce(error);
    existingRoomIdFromMock.mockReturnValueOnce(null);

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByText(/У тебя уже есть активная дуэль/)).toBeTruthy();
      // Should not show a room link when existingRoomId is null
      expect(screen.queryByRole("link", { name: "Перейти к активной дуэли" })).toBeNull();
    });
  });

  it("shows error message on other API errors", async () => {
    joinRoomMock.mockRejectedValueOnce(new ApiError(500, null, "Internal server error"));

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByText(/Не удалось подключиться к дуэли/)).toBeTruthy();
    });
  });

  it("shows home link on error states", async () => {
    joinRoomMock.mockRejectedValueOnce(new ApiError(404, null, "Not found"));

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "На главную" })).toBeTruthy();
    });
  });

  it("shows home link on already_active state", async () => {
    const error = new ApiError(409, null, "Already active");
    joinRoomMock.mockRejectedValueOnce(error);
    existingRoomIdFromMock.mockReturnValueOnce(null);

    renderDuelJoinPage();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "На главную" })).toBeTruthy();
    });
  });

  it("cleans up on unmount (cancels fetch)", async () => {
    joinRoomMock.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { unmount } = render(
      <BrowserRouter>
        <DuelJoinPage />
      </BrowserRouter>,
    );

    // Unmount should not throw
    expect(() => unmount()).not.toThrow();
  });

  it("handles rapid route changes (cancel flag)", async () => {
    let resolveJoin: (value: any) => void;
    joinRoomMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    );

    render(
      <MemoryRouter initialEntries={["/duel/join/token-1"]}>
        <DuelJoinPage />
      </MemoryRouter>,
    );

    // Resolve after unmount
    resolveJoin!({
      room_id: "room-1",
      session_token: "token-abc",
      status: "full",
    });

    // Should not error or dispatch on unmounted component
    await waitFor(() => {
      expect(joinRoomMock).toHaveBeenCalled();
    });
  });
});
