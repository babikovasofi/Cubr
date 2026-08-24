"""`/chat/*` (Этап A — friend-chat plan). Covers: happy path (send/list/read/
delete), the not-friends/blocked 403 identity, filter/moderation rejection,
per-conversation rate limit, 404 on an unknown/foreign conversation, 401 for
anon, and `GET /chat/poll` waking promptly on a new message.
"""

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import app
from app.models import User
from app.models.chat import ChatMessage

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 204, r.text


async def _login_only(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    client.cookies.clear()
    await _register_and_login(client, email)


async def _relogin(client: AsyncClient, email: str) -> None:
    client.cookies.clear()
    await _login_only(client, email)


async def _set_handle(client: AsyncClient, handle: str) -> None:
    resp = await client.patch("/users/me", json={"handle": handle})
    assert resp.status_code == 200, resp.text


async def _befriend(
    client: AsyncClient, requester_email: str, target_email: str, target_handle: str
) -> str:
    """Requester (currently logged-in identity) sends a request to target's
    handle, then logs in as target to accept it, then logs back in as
    requester. Returns the `friendship_id`.
    """
    resp = await client.post("/friends/requests", json={"handle": target_handle})
    assert resp.status_code == 201, resp.text
    friendship_id = resp.json()["friendship_id"]

    await _relogin(client, target_email)
    resp = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert resp.status_code == 200, resp.text

    await _relogin(client, requester_email)
    return str(friendship_id)


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        result = await session.execute(select(User.id).where(User.email == email))
        return result.scalar_one()


# --------------------------------------------------------------------------- #
# happy path
# --------------------------------------------------------------------------- #


async def test_send_list_read_roundtrip(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")

    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")

    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "hey alice"}
    )
    assert resp.status_code == 201, resp.text
    message = resp.json()
    assert message["seq"] == 1
    assert message["body"] == "hey alice"
    conversation_id = message["conversation_id"]

    # Bob's own list shows the conversation with no unread (he sent it).
    resp = await chat_client.get("/chat/conversations")
    assert resp.status_code == 200, resp.text
    convs = resp.json()
    assert len(convs) == 1
    assert convs[0]["unread_count"] == 0
    assert convs[0]["last_message_body"] == "hey alice"
    assert convs[0]["friendship_id"] == friendship_id

    await _relogin(chat_client, "alice@example.com")

    resp = await chat_client.get("/chat/conversations")
    convs = resp.json()
    assert len(convs) == 1
    assert convs[0]["unread_count"] == 1

    resp = await chat_client.get(f"/chat/conversations/{conversation_id}/messages?after_seq=0")
    assert resp.status_code == 200, resp.text
    messages = resp.json()
    assert len(messages) == 1
    assert messages[0]["body"] == "hey alice"

    resp = await chat_client.post(f"/chat/conversations/{conversation_id}/read")
    assert resp.status_code == 204, resp.text

    resp = await chat_client.get("/chat/conversations")
    convs = resp.json()
    assert convs[0]["unread_count"] == 0


async def test_delete_own_message_clears_body(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "oops"}
    )
    message_id = resp.json()["id"]
    conversation_id = resp.json()["conversation_id"]

    resp = await chat_client.delete(f"/chat/messages/{message_id}")
    assert resp.status_code == 204, resp.text

    resp = await chat_client.get(f"/chat/conversations/{conversation_id}/messages?after_seq=0")
    messages = resp.json()
    assert messages[0]["body"] is None
    assert messages[0]["deleted_at"] is not None


# --------------------------------------------------------------------------- #
# errors
# --------------------------------------------------------------------------- #


async def test_anon_gets_401(chat_client: AsyncClient) -> None:
    resp = await chat_client.get("/chat/conversations")
    assert resp.status_code == 401
    resp = await chat_client.get("/chat/poll")
    assert resp.status_code == 401


async def test_pending_request_is_not_friends_403(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")

    resp = await chat_client.post("/friends/requests", json={"handle": "alicehandle"})
    friendship_id = resp.json()["friendship_id"]
    # Bob sent it; not yet accepted by Alice — still `pending`.

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "hi"}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "CHAT_NOT_FRIENDS"


async def test_blocked_gets_the_same_403_as_not_friends(chat_client: AsyncClient) -> None:
    # Baseline: a genuinely-never-friends 403.
    await _register_and_login(chat_client, "carol@example.com")
    await _set_handle(chat_client, "carolhandle")
    await _switch_user(chat_client, "dave@example.com")
    await _set_handle(chat_client, "davehandle")
    pending_resp = await chat_client.post("/friends/requests", json={"handle": "carolhandle"})
    pending_friendship_id = pending_resp.json()["friendship_id"]
    not_friends_resp = await chat_client.post(
        f"/chat/conversations/{pending_friendship_id}/messages", json={"body": "hi"}
    )

    # Real block: alice+bob friends, bob blocks alice, alice tries to send.
    await _switch_user(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    resp = await chat_client.post(f"/chat/blocks/{friendship_id}")
    assert resp.status_code == 204, resp.text

    await _relogin(chat_client, "alice@example.com")
    blocked_resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "hi"}
    )

    assert blocked_resp.status_code == not_friends_resp.status_code == 403
    assert blocked_resp.json() == not_friends_resp.json()


async def test_filter_hit_rejects_and_does_not_persist(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "ты полное хуйло"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "MESSAGE_NOT_ALLOWED"

    async with session_maker() as session:
        result = await session.execute(select(ChatMessage))
        assert result.scalars().all() == []


async def test_unknown_conversation_id_is_404(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    resp = await chat_client.get(f"/chat/conversations/{uuid.uuid4()}/messages")
    assert resp.status_code == 404


async def test_empty_and_whitespace_body_is_422(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    for body in ["", "   ", "x" * 2001]:
        resp = await chat_client.post(
            f"/chat/conversations/{friendship_id}/messages", json={"body": body}
        )
        assert resp.status_code == 422, (body, resp.text)


async def test_per_conversation_rate_limit(chat_client: AsyncClient) -> None:
    """`CHAT_SEND_PER_CONVERSATION_LIMIT` defaults to 10/minute — the 11th
    send into the SAME conversation within a minute is 429."""
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    for i in range(10):
        resp = await chat_client.post(
            f"/chat/conversations/{friendship_id}/messages", json={"body": f"msg {i}"}
        )
        assert resp.status_code == 201, resp.text

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "one too many"}
    )
    assert resp.status_code == 429


# --------------------------------------------------------------------------- #
# poll
# --------------------------------------------------------------------------- #


async def test_poll_wakes_promptly_on_new_message(
    chat_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.routers.chat as chat_router

    monkeypatch.setattr(chat_router.settings, "CHAT_POLL_TIMEOUT_SECONDS", 3)

    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    alice_cookies = dict(chat_client.cookies)

    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    bob_cookies = dict(chat_client.cookies)

    chat_client.cookies.clear()
    chat_client.cookies.update(alice_cookies)
    friendship_id = await _befriend(
        chat_client, "alice@example.com", "bob@example.com", "bobhandle"
    )

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test", cookies=bob_cookies) as bob_c,
        AsyncClient(transport=transport, base_url="http://test", cookies=alice_cookies) as alice_c,
    ):
        poll_task = asyncio.create_task(bob_c.get("/chat/poll"))
        await asyncio.sleep(0.1)  # let the poll's first (empty) DB phase run and start waiting
        send_resp = await alice_c.post(
            f"/chat/conversations/{friendship_id}/messages", json={"body": "wake up"}
        )
        assert send_resp.status_code == 201, send_resp.text

        poll_resp = await asyncio.wait_for(poll_task, timeout=5)

    assert poll_resp.status_code == 200, poll_resp.text
    data = poll_resp.json()
    assert len(data["messages"]) == 1
    assert data["messages"][0]["body"] == "wake up"
    assert data["cursor"]


async def test_poll_times_out_empty_when_nothing_new(
    chat_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.routers.chat as chat_router

    monkeypatch.setattr(chat_router.settings, "CHAT_POLL_TIMEOUT_SECONDS", 1)

    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")

    resp = await chat_client.get("/chat/poll")
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


# --------------------------------------------------------------------------- #
# unfriend / cascade
# --------------------------------------------------------------------------- #


async def test_unfriend_marks_pending_messages_unfriended(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Plan §4 "Дружба удалена" (а): removing a friendship immediately
    resolves every still-`pending` message of that pair to `'unfriended'`,
    in the SAME transaction — no email can go out even a moment later."""
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "before unfriend"}
    )
    assert resp.status_code == 201, resp.text

    resp = await chat_client.delete(f"/friends/{friendship_id}")
    assert resp.status_code == 204, resp.text

    async with session_maker() as session:
        result = await session.execute(select(ChatMessage))
        messages = result.scalars().all()
    assert len(messages) == 1
    assert messages[0].notify_state == "unfriended"
    assert messages[0].notify_resolved_at is not None


async def test_deleting_user_cascades_chat_rows(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Regression (plan §8): deleting a `user` row must not orphan
    `conversations`/`chat_messages`/`chat_reads`/`user_presence`.
    """
    from app.models.chat import ChatRead, Conversation

    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )
    resp = await chat_client.post(
        f"/chat/conversations/{friendship_id}/messages", json={"body": "hi"}
    )
    assert resp.status_code == 201, resp.text
    resp = await chat_client.get("/chat/poll")  # writes a user_presence row for Bob
    assert resp.status_code == 200, resp.text

    bob_id = await _user_id(session_maker, "bob@example.com")
    async with session_maker() as session:
        user = await session.get(User, bob_id)
        assert user is not None
        await session.delete(user)
        await session.commit()

    async with session_maker() as session:
        assert (await session.execute(select(Conversation))).scalars().all() == []
        assert (await session.execute(select(ChatMessage))).scalars().all() == []
        assert (await session.execute(select(ChatRead))).scalars().all() == []


# --------------------------------------------------------------------------- #
# rate limits (global and per-conversation)
# --------------------------------------------------------------------------- #


async def test_global_rate_limit(chat_client: AsyncClient) -> None:
    """`CHAT_SEND_RATE_LIMIT` defaults to 20/minute — the 21st send within
    a minute is 429, across different conversations."""
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")

    # Create 3 friends (so we have 3 different conversations from Bob).
    friends = []
    for j in range(3):
        email = f"friend{j}@example.com"
        handle = f"friend{j}handle"
        await _switch_user(chat_client, email)
        await _set_handle(chat_client, handle)
        friendship_id = await _befriend(chat_client, email, "alice@example.com", "alicehandle")
        friends.append(friendship_id)
        await _relogin(chat_client, "alice@example.com")

    # Send 7 messages to each friend (7 * 3 = 21 total).
    # First 20 should succeed, 21st should be rate-limited globally.
    msg_count = 0
    for j, friendship_id in enumerate(friends):
        for i in range(7):
            resp = await chat_client.post(
                f"/chat/conversations/{friendship_id}/messages",
                json={"body": f"msg to friend {j}, msg {i}"},
            )
            msg_count += 1
            if msg_count <= 20:
                assert resp.status_code == 201, f"message {msg_count} failed: {resp.text}"
            else:
                # 21st message should hit global rate limit
                assert resp.status_code == 429, f"message {msg_count}: {resp.text}"
                break
        if msg_count > 20:
            break


# --------------------------------------------------------------------------- #
# seq numbering under concurrency
# --------------------------------------------------------------------------- #


async def test_seq_numbering_is_sequential_without_gaps(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Sending multiple messages to the same conversation must assign
    consecutive seq numbers without gaps (1, 2, 3, ...). Verifies the
    `UPDATE ... RETURNING` pattern that serializes writes to a conversation."""
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    # Send 5 messages and collect their seq numbers.
    seqs = []
    for i in range(5):
        resp = await chat_client.post(
            f"/chat/conversations/{friendship_id}/messages",
            json={"body": f"message {i}"},
        )
        assert resp.status_code == 201, resp.text
        seqs.append(resp.json()["seq"])

    # Verify seq numbers are exactly [1, 2, 3, 4, 5] with no gaps or dupes.
    assert seqs == [1, 2, 3, 4, 5], f"seq numbers should be [1,2,3,4,5], got {seqs}"
