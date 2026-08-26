// @vitest-environment jsdom
//
// InviteMessage — the duel-invite chat bubble (friends-hub plan, Этап B).
// Covers every DuelInviteRead.state and the accept→navigate happy path.
// api/chat, api/duel and the toast queue are all mocked — no real network,
// no real duel-session storage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import InviteMessage from "../../../src/friends/chat/InviteMessage";
import { ApiError } from "../../../src/api/client";
import type { ChatMessage, DuelInviteRead } from "../../../src/api/chat";

const {
  acceptInviteMock,
  declineInviteMock,
  cancelInviteMock,
  saveDuelSessionTokenMock,
  navigateMock,
  toastMock,
} = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  declineInviteMock: vi.fn(),
  cancelInviteMock: vi.fn(),
  saveDuelSessionTokenMock: vi.fn(),
  navigateMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("../../../src/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/chat")>();
  return {
    ...actual,
    acceptInvite: acceptInviteMock,
    declineInvite: declineInviteMock,
    cancelInvite: cancelInviteMock,
  };
});

vi.mock("../../../src/api/duel", () => ({
  saveDuelSessionToken: saveDuelSessionTokenMock,
}));

vi.mock("../../../src/components/Toast", () => ({
  toast: toastMock,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const BASE_INVITE: DuelInviteRead = {
  id: "invite-1",
  inviter_id: "me",
  invitee_id: "friend-1",
  state: "pending",
  room_id: null,
  expires_at: "2026-08-26T00:03:00Z",
  can_accept: false,
  can_decline: false,
  can_cancel: true,
  seconds_left: 125,
  session_token: null,
};

function messageWith(invite: DuelInviteRead | null): ChatMessage {
  return {
    id: "msg-invite-1",
    conversation_id: "conv-1",
    seq: 1,
    sender_id: invite?.inviter_id ?? "me",
    body: null,
    kind: "invite",
    invite,
    created_at: "2026-08-26T00:00:00Z",
    deleted_at: null,
  };
}

function renderInvite(invite: DuelInviteRead, meUserId = "me") {
  const onInviteUpdated = vi.fn();
  const utils = render(
    <BrowserRouter>
      <InviteMessage
        message={messageWith(invite)}
        meUserId={meUserId}
        friendDisplayName="SpeedCuber"
        onInviteUpdated={onInviteUpdated}
      />
    </BrowserRouter>,
  );
  return { ...utils, onInviteUpdated };
}

beforeEach(() => {
  for (const m of [
    acceptInviteMock,
    declineInviteMock,
    cancelInviteMock,
    saveDuelSessionTokenMock,
    navigateMock,
    toastMock,
  ]) {
    m.mockReset();
  }
});

afterEach(cleanup);

describe("InviteMessage — pending, я приглашённый", () => {
  it("показывает Принять/Отклонить, отключены по can_accept/can_decline", () => {
    renderInvite(
      { ...BASE_INVITE, can_accept: false, can_decline: false, can_cancel: false },
      "friend-1",
    );

    expect((screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Отклонить" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("клик «Принять» с валидными can_accept вызывает acceptInvite и переходит в дуэль", async () => {
    acceptInviteMock.mockResolvedValue({
      id: "invite-1",
      state: "accepted",
      room_id: "room-9",
      session_token: "sess-9",
    });

    const { onInviteUpdated } = renderInvite({ ...BASE_INVITE, can_accept: true }, "friend-1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    });

    await waitFor(() => expect(acceptInviteMock).toHaveBeenCalledWith("invite-1"));
    expect(saveDuelSessionTokenMock).toHaveBeenCalledWith("room-9", "sess-9");
    expect(navigateMock).toHaveBeenCalledWith("/duel/room-9");
    expect(onInviteUpdated).toHaveBeenCalledWith(
      "msg-invite-1",
      expect.objectContaining({ state: "accepted", room_id: "room-9" }),
    );
  });

  it("409 already-in-game — тост «Соперник уже в дуэли», без навигации", async () => {
    acceptInviteMock.mockRejectedValue(
      new ApiError(409, "CHAT_INVITE_ALREADY_IN_GAME", "Соперник уже в дуэли.", {
        existing_room_id: "room-old",
      }),
    );

    renderInvite({ ...BASE_INVITE, can_accept: true }, "friend-1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Соперник уже в дуэли.", "error"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("клик «Отклонить» вызывает declineInvite, без навигации", async () => {
    declineInviteMock.mockResolvedValue({
      id: "invite-1",
      state: "declined",
      room_id: null,
      session_token: null,
    });

    const { onInviteUpdated } = renderInvite({ ...BASE_INVITE, can_decline: true }, "friend-1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    });

    await waitFor(() => expect(declineInviteMock).toHaveBeenCalledWith("invite-1"));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(onInviteUpdated).toHaveBeenCalledWith(
      "msg-invite-1",
      expect.objectContaining({ state: "declined" }),
    );
  });
});

describe("InviteMessage — pending, я пригласивший", () => {
  it("показывает только «Отменить», не Принять/Отклонить", () => {
    renderInvite(
      { ...BASE_INVITE, inviter_id: "me", invitee_id: "friend-1", can_cancel: true },
      "me",
    );

    expect(screen.getByRole("button", { name: "Отменить" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Принять" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отклонить" })).toBeNull();
  });

  it("клик «Отменить» вызывает cancelInvite", async () => {
    cancelInviteMock.mockResolvedValue({
      id: "invite-1",
      state: "canceled",
      room_id: null,
      session_token: null,
    });

    renderInvite({ ...BASE_INVITE, can_cancel: true });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    });

    await waitFor(() => expect(cancelInviteMock).toHaveBeenCalledWith("invite-1"));
  });
});

describe("InviteMessage — accepted", () => {
  it("«Войти в дуэль» сохраняет токен и переходит в комнату", async () => {
    renderInvite({
      ...BASE_INVITE,
      state: "accepted",
      room_id: "room-42",
      session_token: "sess-42",
      can_accept: false,
      can_decline: false,
      can_cancel: false,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Войти в дуэль" }));
    });

    expect(saveDuelSessionTokenMock).toHaveBeenCalledWith("room-42", "sess-42");
    expect(navigateMock).toHaveBeenCalledWith("/duel/room-42");
  });
});

describe("InviteMessage — терминальные состояния тихие", () => {
  it("declined — текст без кнопок действий", () => {
    renderInvite({ ...BASE_INVITE, state: "declined", can_accept: false, can_decline: false });
    expect(screen.getByText("Приглашение отклонено.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Принять" })).toBeNull();
  });

  it("canceled — текст без кнопок действий", () => {
    renderInvite({ ...BASE_INVITE, state: "canceled", can_cancel: false });
    expect(screen.getByText("Приглашение отменено.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить" })).toBeNull();
  });

  it("expired — текст, can_accept уже false от сервера", () => {
    renderInvite({ ...BASE_INVITE, state: "expired", can_accept: false, can_decline: false });
    expect(screen.getByText("Время приглашения истекло.")).toBeTruthy();
  });
});

describe("InviteMessage — локальный отсчёт", () => {
  it("по достижении 0 кнопки гаснут локально, не дожидаясь сервера", async () => {
    vi.useFakeTimers();
    try {
      renderInvite(
        { ...BASE_INVITE, can_accept: true, can_decline: true, seconds_left: 2 },
        "friend-1",
      );

      expect(
        (screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement).disabled,
      ).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(
        (screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
