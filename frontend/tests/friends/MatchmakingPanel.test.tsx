// @vitest-environment jsdom
//
// MatchmakingPanel — random-opponent queue (friends-hub plan, Этап C).
// api/matchmaking and api/duel are mocked — no real network, no real
// duel-session storage. Covers idle→searching, immediate match, poll-driven
// match, cancel, and the 409-already-in-game path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import MatchmakingPanel from "../../src/friends/MatchmakingPanel";
import { ApiError } from "../../src/api/client";

const {
  enqueueMatchmakingMock,
  cancelMatchmakingMock,
  pollMatchmakingMock,
  saveDuelSessionTokenMock,
  navigateMock,
} = vi.hoisted(() => ({
  enqueueMatchmakingMock: vi.fn(),
  cancelMatchmakingMock: vi.fn(),
  pollMatchmakingMock: vi.fn(),
  saveDuelSessionTokenMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../src/api/matchmaking", () => ({
  enqueueMatchmaking: enqueueMatchmakingMock,
  cancelMatchmaking: cancelMatchmakingMock,
  pollMatchmaking: pollMatchmakingMock,
}));

vi.mock("../../src/api/duel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/duel")>();
  return { ...actual, saveDuelSessionToken: saveDuelSessionTokenMock };
});

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("../../src/components/Toast", () => ({ toast: toastMock }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPanel() {
  return render(
    <BrowserRouter>
      <MatchmakingPanel />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  for (const m of [
    enqueueMatchmakingMock,
    cancelMatchmakingMock,
    pollMatchmakingMock,
    saveDuelSessionTokenMock,
    navigateMock,
    toastMock,
  ]) {
    m.mockReset();
  }
  cancelMatchmakingMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("MatchmakingPanel — сразу нашёлся соперник", () => {
  it("enqueue с matched:true сразу переходит в дуэль", async () => {
    enqueueMatchmakingMock.mockResolvedValue({
      matched: true,
      room_id: "room-1",
      session_token: "sess-1",
    });

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Случайный соперник" }));
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/duel/room-1"));
    expect(saveDuelSessionTokenMock).toHaveBeenCalledWith("room-1", "sess-1");
  });
});

describe("MatchmakingPanel — ждём в очереди", () => {
  it("matched:false переводит в «Ищем соперника…» и опрашивает poll до матча", async () => {
    enqueueMatchmakingMock.mockResolvedValue({ matched: false, room_id: null, session_token: null });
    let resolvePoll: ((r: unknown) => void) | null = null;
    pollMatchmakingMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Случайный соперник" }));
    });

    await waitFor(() => expect(screen.getByText("Ищем соперника…")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Случайный соперник" })).toBeNull();

    await act(async () => {
      resolvePoll?.({ matched: true, room_id: "room-2", session_token: "sess-2" });
      await Promise.resolve();
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/duel/room-2"));
  });

  it("«Отменить поиск» вызывает cancelMatchmaking и возвращается в idle", async () => {
    enqueueMatchmakingMock.mockResolvedValue({ matched: false, room_id: null, session_token: null });
    pollMatchmakingMock.mockReturnValue(new Promise(() => undefined));

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Случайный соперник" }));
    });
    await waitFor(() => expect(screen.getByText("Ищем соперника…")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отменить поиск" }));
    });

    await waitFor(() => expect(cancelMatchmakingMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Случайный соперник" })).toBeTruthy();
  });
});

describe("MatchmakingPanel — уже в активной дуэли", () => {
  it("409 показывает ошибку и ссылку на активную дуэль, остаётся idle", async () => {
    enqueueMatchmakingMock.mockRejectedValue(
      new ApiError(409, "MATCHMAKING_ALREADY_IN_GAME", "У тебя уже есть активная дуэль.", {
        existing_room_id: "room-old",
      }),
    );

    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Случайный соперник" }));
    });

    await waitFor(() =>
      expect(screen.getByText("У тебя уже есть активная дуэль.")).toBeTruthy(),
    );
    expect(toastMock).toHaveBeenCalledWith("У тебя уже есть активная дуэль.", "error");
    const link = screen.getByRole("link", { name: "Перейти к активной дуэли" });
    expect(link.getAttribute("href")).toBe("/duel/room-old");
    expect(screen.getByRole("button", { name: "Случайный соперник" })).toBeTruthy();
  });
});
