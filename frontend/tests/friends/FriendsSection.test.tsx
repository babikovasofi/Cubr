// @vitest-environment jsdom
//
// FriendsSection — секция на /profile (plan: friends). Мокаем src/api/friends
// и src/api/duel целиком (как tests/duel/DuelPage.test.tsx), без реальной
// сети. Моки НАМЕРЕННО не содержат email/uuid — это и проверяет тест "нет PII".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import FriendsSection from "../../src/friends/FriendsSection";
import { ApiError } from "../../src/api/client";
import type { FriendRead, FriendRequestRead } from "../../src/api/friends";

const {
  listFriendsMock,
  listIncomingMock,
  listOutgoingMock,
  sendRequestMock,
  acceptRequestMock,
  deleteRequestMock,
  removeFriendMock,
  createRoomMock,
  navigateMock,
  listConversationsMock,
  pollChatMock,
} = vi.hoisted(() => ({
  listFriendsMock: vi.fn(),
  listIncomingMock: vi.fn(),
  listOutgoingMock: vi.fn(),
  sendRequestMock: vi.fn(),
  acceptRequestMock: vi.fn(),
  deleteRequestMock: vi.fn(),
  removeFriendMock: vi.fn(),
  createRoomMock: vi.fn(),
  navigateMock: vi.fn(),
  listConversationsMock: vi.fn(),
  pollChatMock: vi.fn(),
}));

vi.mock("../../src/api/friends", () => ({
  listFriends: listFriendsMock,
  listIncoming: listIncomingMock,
  listOutgoing: listOutgoingMock,
  sendRequest: sendRequestMock,
  acceptRequest: acceptRequestMock,
  deleteRequest: deleteRequestMock,
  removeFriend: removeFriendMock,
}));

// This section mounts <ChatSection>, which owns the per-tab long-poll loop —
// chat/useChatPoll.test.tsx covers its behaviour in depth. Here it is mocked
// so FriendsSection's own tests stay about the friend list, not the chat
// poll loop, and never leave a real long-poll hanging after the test ends.
vi.mock("../../src/api/chat", () => ({
  listConversations: listConversationsMock,
  listMessages: vi.fn().mockResolvedValue([]),
  pollChat: pollChatMock,
  sendMessage: vi.fn(),
  markRead: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn(),
  blockFriend: vi.fn(),
  unblockFriend: vi.fn(),
}));

vi.mock("../../src/store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "me" } }),
}));

vi.mock("../../src/api/duel", () => ({
  createRoom: createRoomMock,
  saveDuelSessionToken: vi.fn(),
  existingRoomIdFrom: (e: ApiError) =>
    (e.body as { existing_room_id?: string } | null)?.existing_room_id ?? null,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const FRIEND_SPEEDCUBER: FriendRead = {
  friendship_id: "friendship-friend-1",
  display_name: "SpeedCuber",
  since: "2026-08-01T00:00:00Z",
};

const FRIEND_ANON: FriendRead = {
  friendship_id: "friendship-friend-2",
  display_name: "Аноним",
  since: "2026-08-02T00:00:00Z",
};

const INCOMING: FriendRequestRead = {
  friendship_id: "friendship-incoming-1",
  display_name: "CubeMaster",
  created_at: "2026-08-03T00:00:00Z",
};

const OUTGOING: FriendRequestRead = {
  friendship_id: "friendship-outgoing-1",
  display_name: "ThirdWheel",
  created_at: "2026-08-04T00:00:00Z",
};

function renderSection() {
  return render(
    <BrowserRouter>
      <FriendsSection />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  for (const m of [
    listFriendsMock,
    listIncomingMock,
    listOutgoingMock,
    sendRequestMock,
    acceptRequestMock,
    deleteRequestMock,
    removeFriendMock,
    createRoomMock,
    navigateMock,
    listConversationsMock,
    pollChatMock,
  ]) {
    m.mockReset();
  }
  listFriendsMock.mockResolvedValue([]);
  listIncomingMock.mockResolvedValue([]);
  listOutgoingMock.mockResolvedValue([]);
  listConversationsMock.mockResolvedValue([]);
  // Never resolves: ChatSection's poll loop just hangs quietly, same as the
  // real long-poll waiting on the server (plan §2) — nothing to assert on it
  // from these friend-list-focused tests.
  pollChatMock.mockReturnValue(new Promise(() => undefined));
});

afterEach(cleanup);

describe("FriendsSection — список друзей", () => {
  it("показывает друзей, включая Анонима", async () => {
    listFriendsMock.mockResolvedValue([FRIEND_SPEEDCUBER, FRIEND_ANON]);

    renderSection();

    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());
    expect(screen.getByText("Аноним")).toBeTruthy();
  });

  it("пустой список друзей зовёт добавить кого-нибудь", async () => {
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/Пока нет друзей — добавь кого-нибудь по нику выше/)).toBeTruthy(),
    );
  });
});

describe("FriendsSection — добавление по нику", () => {
  it("рядом с полем есть подсказка формата, а не слово «хэндл»", async () => {
    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText("Ник друга")).toBeTruthy();
    expect(screen.getByText("Буквы, цифры, пробел, дефис, точка и подчёркивание.")).toBeTruthy();
    expect(screen.queryByText(/хэндл/i)).toBeNull();
  });

  it("срезает ведущую собаку при вводе — в sendRequest уезжает голый ник", async () => {
    sendRequestMock.mockResolvedValue({
      friendship_id: "friendship-new",
      display_name: "NewFriend",
      created_at: "2026-08-05T00:00:00Z",
    });

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "@NewFriend" } });
    });
    expect(input.value).toBe("NewFriend");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() => expect(sendRequestMock).toHaveBeenCalledWith("NewFriend"));
  });

  it("успешная заявка очищает поле и перезагружает списки", async () => {
    sendRequestMock.mockResolvedValue({
      friendship_id: "friendship-new",
      display_name: "NewFriend",
      created_at: "2026-08-05T00:00:00Z",
    });

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "NewFriend" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() => expect(sendRequestMock).toHaveBeenCalledWith("NewFriend"));
    expect(input.value).toBe("");
    // reload triggered — a second round of list fetches
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(2));
  });

  it("404 — «Такого ника нет», форма не очищается", async () => {
    sendRequestMock.mockRejectedValue(new ApiError(404, null, "Not found"));

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Ghost" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() => expect(screen.getByText("Такого ника нет.")).toBeTruthy());
    expect(input.value).toBe("Ghost");
  });

  it("403 HANDLE_REQUIRED — подсказка задать свой ник", async () => {
    sendRequestMock.mockRejectedValue(
      new ApiError(
        403,
        "HANDLE_REQUIRED",
        "Сначала укажи свой ник в профиле — без него нельзя добавлять друзей.",
      ),
    );

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "SpeedCuber" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() =>
      expect(
        screen.getByText("Сначала укажи свой ник в профиле — без него нельзя добавлять друзей."),
      ).toBeTruthy(),
    );
    expect(input.value).toBe("SpeedCuber");
  });

  it("409 — «уже отправлено» / «уже друзья»", async () => {
    sendRequestMock.mockRejectedValue(
      new ApiError(409, "FRIEND_ALREADY_PENDING", "Заявка уже отправлена — жди ответа."),
    );

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "SpeedCuber" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() =>
      expect(screen.getByText("Заявка уже отправлена — жди ответа.")).toBeTruthy(),
    );
    expect(input.value).toBe("SpeedCuber");
  });

  it("409 — «уже друзья»", async () => {
    sendRequestMock.mockRejectedValue(
      new ApiError(409, "FRIEND_ALREADY_FRIENDS", "Вы уже друзья."),
    );

    renderSection();
    await waitFor(() => expect(listFriendsMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Ник друга") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "SpeedCuber" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    });

    await waitFor(() => expect(screen.getByText("Вы уже друзья.")).toBeTruthy());
    expect(input.value).toBe("SpeedCuber");
  });
});

describe("FriendsSection — входящие и исходящие заявки", () => {
  it("принять входящую вызывает acceptRequest с верным friendship_id и перезагружает", async () => {
    listIncomingMock.mockResolvedValue([INCOMING]);
    acceptRequestMock.mockResolvedValue({
      friendship_id: INCOMING.friendship_id,
      display_name: INCOMING.display_name,
      since: "2026-08-06T00:00:00Z",
    });

    renderSection();
    await waitFor(() => expect(screen.getByText("CubeMaster")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    });

    await waitFor(() => expect(acceptRequestMock).toHaveBeenCalledWith(INCOMING.friendship_id));
    // reload — listIncoming called again after accept
    await waitFor(() => expect(listIncomingMock).toHaveBeenCalledTimes(2));
  });

  it("отклонить входящую вызывает deleteRequest с верным friendship_id", async () => {
    listIncomingMock.mockResolvedValue([INCOMING]);
    deleteRequestMock.mockResolvedValue(undefined);

    renderSection();
    await waitFor(() => expect(screen.getByText("CubeMaster")).toBeTruthy());

    const incomingSection = screen.getByText("Входящие заявки").closest("div") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(incomingSection).getByRole("button", { name: "Отклонить" }));
    });

    await waitFor(() => expect(deleteRequestMock).toHaveBeenCalledWith(INCOMING.friendship_id));
  });

  it("отменить исходящую вызывает deleteRequest с верным friendship_id", async () => {
    listOutgoingMock.mockResolvedValue([OUTGOING]);
    deleteRequestMock.mockResolvedValue(undefined);

    renderSection();
    await waitFor(() => expect(screen.getByText("ThirdWheel")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    });

    await waitFor(() => expect(deleteRequestMock).toHaveBeenCalledWith(OUTGOING.friendship_id));
  });
});

describe("FriendsSection — удаление друга", () => {
  it("клик «Удалить» вызывает removeFriend с верным friendship_id", async () => {
    listFriendsMock.mockResolvedValue([FRIEND_SPEEDCUBER]);
    removeFriendMock.mockResolvedValue(undefined);

    renderSection();
    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    });

    await waitFor(() =>
      expect(removeFriendMock).toHaveBeenCalledWith(FRIEND_SPEEDCUBER.friendship_id),
    );
  });
});

describe("FriendsSection — вызов в один клик", () => {
  it("клик «Вызвать» создаёт комнату и переходит в неё с joinUrl в state", async () => {
    listFriendsMock.mockResolvedValue([FRIEND_SPEEDCUBER]);
    createRoomMock.mockResolvedValue({
      room_id: "room-xyz",
      invite_token: "invite-xyz",
      session_token: "session-xyz",
      mode: "duel",
      event: "3x3",
      join_url: "https://cubr.example/duel/join/invite-xyz",
    });

    renderSection();
    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Вызвать" }));
    });

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/duel/room-xyz", {
        state: { joinUrl: "https://cubr.example/duel/join/invite-xyz" },
      }),
    );
  });

  it("409 (уже есть активная комната) не роняет секцию — предлагает переход", async () => {
    listFriendsMock.mockResolvedValue([FRIEND_SPEEDCUBER]);
    createRoomMock.mockRejectedValue(
      new ApiError(409, null, "already active", { existing_room_id: "room-old" }),
    );

    renderSection();
    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Вызвать" }));
    });

    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());
    const link = await screen.findByRole("link", { name: "Перейти к активной дуэли" });
    expect(link.getAttribute("href")).toBe("/duel/room-old");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("FriendsSection — приватность", () => {
  it("в разметке нет email и UUID-подобных подстрок", async () => {
    listFriendsMock.mockResolvedValue([FRIEND_SPEEDCUBER, FRIEND_ANON]);
    listIncomingMock.mockResolvedValue([INCOMING]);
    listOutgoingMock.mockResolvedValue([OUTGOING]);

    const { container } = renderSection();

    await waitFor(() => expect(screen.getByText("SpeedCuber")).toBeTruthy());

    const text = container.textContent ?? "";
    expect(text).not.toContain("@");
    const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(uuidLike.test(text)).toBe(false);
  });
});
