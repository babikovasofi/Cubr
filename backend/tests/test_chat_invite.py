"""`/chat/conversations/{id}/invite` + `/chat/invites/{id}/{accept,decline,
cancel}` — friends-hub plan, Этап B. Covers: pending invite carries no room
yet (skeptic HIGH#1), accept creates/joins a room and mints both tokens,
accept/decline/cancel guard shapes (403 wrong caller, 404 not-actionable —
repeat or expired), the concurrent-accept race courtesy (decline/cancel
after a race-losing accept abandons the room), already-in-game 409 leaving
the invite pending, N invites to N different friends costing zero duel
slots, and the invite message NEVER reaching the chat-email sweep.
"""

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.routers.chat as chat_router
import app.services.chat_invite as chat_invite_module
from app.jobs import chat_notify
from app.models import User
from app.models.duel import DuelRoom
from app.models.duel_participant import DuelParticipant
from app.models.duel_invite import DuelInvite

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


async def _send_invite(client: AsyncClient, friendship_id: str) -> dict[str, object]:
    resp = await client.post(f"/chat/conversations/{friendship_id}/invite")
    assert resp.status_code == 201, resp.text
    return resp.json()


# --------------------------------------------------------------------------- #
# happy path
# --------------------------------------------------------------------------- #


async def test_invite_pending_has_no_room_yet(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    message = await _send_invite(chat_client, friendship_id)
    assert message["kind"] == "invite"
    assert message["body"] is None
    invite = message["invite"]
    assert invite["state"] == "pending"
    assert invite["room_id"] is None
    assert invite["session_token"] is None
    # Sender (inviter) sees can_cancel, not can_accept.
    assert invite["can_cancel"] is True
    assert invite["can_accept"] is False
    assert invite["can_decline"] is False
    assert invite["seconds_left"] > 0


async def test_accept_creates_room_and_mints_both_tokens(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    # Alice invites bob.
    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]
    conversation_id = message["conversation_id"]

    # Bob (invitee) accepts.
    await _relogin(chat_client, "bob@example.com")
    resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "accepted"
    assert body["room_id"] is not None
    assert body["session_token"]
    room_id = body["room_id"]

    # Both players are active participants of the SAME room.
    async with session_maker() as session:
        room = await session.get(DuelRoom, uuid.UUID(room_id))
        assert room is not None
        assert room.status in ("full", "active")
        result = await session.execute(
            select(DuelParticipant).where(DuelParticipant.room_id == room.id)
        )
        participants = {p.user_id: p.active for p in result.scalars().all()}
        assert len(participants) == 2
        assert all(participants.values())

    # Alice (inviter) re-reads the conversation and gets her OWN fresh
    # session_token, freshly derived — never stored on create.
    await _relogin(chat_client, "alice@example.com")
    resp = await chat_client.get(f"/chat/conversations/{conversation_id}/messages?after_seq=0")
    assert resp.status_code == 200, resp.text
    invite_read = resp.json()[0]["invite"]
    assert invite_read["state"] == "accepted"
    assert invite_read["room_id"] == room_id
    assert invite_read["session_token"]
    assert invite_read["can_accept"] is False
    assert invite_read["can_cancel"] is False


async def test_n_invites_to_different_friends_cost_zero_slots(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")

    friendship_ids = []
    for i in range(3):
        friend_email = f"friend{i}@example.com"
        await _switch_user(chat_client, friend_email)
        await _set_handle(chat_client, f"friend{i}handle")
        friendship_id = await _befriend(
            chat_client, friend_email, "alice@example.com", "alicehandle"
        )
        friendship_ids.append(friendship_id)

    await _relogin(chat_client, "alice@example.com")
    for friendship_id in friendship_ids:
        message = await _send_invite(chat_client, friendship_id)
        assert message["invite"]["state"] == "pending"
        assert message["invite"]["room_id"] is None


# --------------------------------------------------------------------------- #
# guard shapes
# --------------------------------------------------------------------------- #


async def test_accept_by_someone_else_is_403(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    # A third, unrelated user tries to accept.
    await _switch_user(chat_client, "carol@example.com")
    resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert resp.status_code == 403, resp.text


async def test_accept_twice_is_404_idempotent(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    await _relogin(chat_client, "bob@example.com")
    first = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert first.status_code == 200, first.text

    second = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert second.status_code == 404, second.text
    assert second.json()["detail"]["code"] == "CHAT_INVITE_NOT_ACTIONABLE"

    # And a third call is the SAME 404 — idempotent, never a 500.
    third = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert third.status_code == 404, third.text


async def test_unknown_invite_is_404(chat_client: AsyncClient) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    resp = await chat_client.post(f"/chat/invites/{uuid.uuid4()}/accept")
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"]["code"] == "CHAT_INVITE_NOT_FOUND"


async def test_decline_and_cancel_resolve_state(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    # Bob declines an invite from alice.
    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    await _relogin(chat_client, "bob@example.com")
    resp = await chat_client.post(f"/chat/invites/{invite_id}/decline")
    assert resp.status_code == 200, resp.text
    assert resp.json()["state"] == "declined"
    assert resp.json()["room_id"] is None

    # Alice cancels a DIFFERENT invite she sent.
    await _relogin(chat_client, "alice@example.com")
    message2 = await _send_invite(chat_client, friendship_id)
    invite_id2 = message2["invite"]["id"]
    resp = await chat_client.post(f"/chat/invites/{invite_id2}/cancel")
    assert resp.status_code == 200, resp.text
    assert resp.json()["state"] == "canceled"

    # Only the inviter may cancel, only the invitee may decline.
    message3 = await _send_invite(chat_client, friendship_id)
    invite_id3 = message3["invite"]["id"]
    resp = await chat_client.post(f"/chat/invites/{invite_id3}/decline")  # alice declining her own
    assert resp.status_code == 403, resp.text

    await _relogin(chat_client, "bob@example.com")
    resp = await chat_client.post(f"/chat/invites/{invite_id3}/cancel")  # bob canceling alice's
    assert resp.status_code == 403, resp.text


async def test_decline_after_race_lost_to_accept_abandons_room(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """A double-tap: bob's accept lands first, then his own stale decline
    request arrives — the decline is honored (state -> declined) and the
    room it raced against is abandoned, not left dangling `full`/`active`.
    """
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    await _relogin(chat_client, "bob@example.com")
    accept_resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert accept_resp.status_code == 200, accept_resp.text
    room_id = accept_resp.json()["room_id"]

    decline_resp = await chat_client.post(f"/chat/invites/{invite_id}/decline")
    assert decline_resp.status_code == 200, decline_resp.text
    assert decline_resp.json()["state"] == "declined"

    async with session_maker() as session:
        room = await session.get(DuelRoom, uuid.UUID(room_id))
        assert room is not None
        assert room.status == "abandoned"
        invite = await session.get(DuelInvite, uuid.UUID(invite_id))
        assert invite is not None
        assert invite.state == "declined"


async def test_cancel_after_race_lost_to_accept_abandons_room(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    await _relogin(chat_client, "bob@example.com")
    accept_resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert accept_resp.status_code == 200, accept_resp.text
    room_id = accept_resp.json()["room_id"]

    await _relogin(chat_client, "alice@example.com")
    cancel_resp = await chat_client.post(f"/chat/invites/{invite_id}/cancel")
    assert cancel_resp.status_code == 200, cancel_resp.text
    assert cancel_resp.json()["state"] == "canceled"

    async with session_maker() as session:
        room = await session.get(DuelRoom, uuid.UUID(room_id))
        assert room is not None
        assert room.status == "abandoned"


async def test_expired_invite_shows_cannot_accept_and_404s_on_click(
    chat_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(chat_router.settings, "INVITE_TTL_SECONDS", 1)

    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]
    conversation_id = message["conversation_id"]

    from app.services.friends import now_utc as real_now_utc

    future = real_now_utc() + timedelta(seconds=30)
    monkeypatch.setattr(chat_router, "now_utc", lambda: future)
    monkeypatch.setattr(chat_invite_module, "now_utc", lambda: future)

    # Display-time derivation: a plain read shows "expired" and a
    # disabled button, without persisting anything.
    resp = await chat_client.get(f"/chat/conversations/{conversation_id}/messages?after_seq=0")
    invite_read = resp.json()[0]["invite"]
    assert invite_read["state"] == "expired"
    assert invite_read["can_accept"] is False
    assert invite_read["seconds_left"] == 0

    # A click that lands anyway (race with the disabled button) gets a
    # clean, idempotent 404 — never a 500, never treated as a fresh accept.
    await _relogin(chat_client, "bob@example.com")
    resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"]["code"] == "CHAT_INVITE_NOT_ACTIONABLE"


async def test_already_in_game_leaves_invite_pending(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    # Bob starts (and stays in) an unrelated duel via the link-invite path.
    await _relogin(chat_client, "bob@example.com")
    other_room_resp = await chat_client.post("/duel/rooms")
    assert other_room_resp.status_code == 201, other_room_resp.text

    resp = await chat_client.post(f"/chat/invites/{invite_id}/accept")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "CHAT_INVITE_ALREADY_IN_GAME"

    async with session_maker() as session:
        invite = await session.get(DuelInvite, uuid.UUID(invite_id))
        assert invite is not None
        assert invite.state == "pending"
        assert invite.room_id is None


# --------------------------------------------------------------------------- #
# email sweep must never see an invite
# --------------------------------------------------------------------------- #


async def test_invite_never_reaches_email_sweep(
    chat_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[object] = []

    async def _spy_send(*args: object, **kwargs: object) -> None:
        calls.append((args, kwargs))

    monkeypatch.setattr(chat_notify, "send_chat_notification", _spy_send)

    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    await _send_invite(chat_client, friendship_id)

    count = await chat_notify.run()
    assert count == 0
    assert calls == []


# --------------------------------------------------------------------------- #
# cascade
# --------------------------------------------------------------------------- #


async def test_deleting_user_cascades_duel_invite_row(
    chat_client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Regression: deleting a `user` row must not orphan `duel_invites` —
    both `inviter_id`/`invitee_id` FKs are `ON DELETE CASCADE`
    (migration 0018).
    """
    await _register_and_login(chat_client, "alice@example.com")
    await _set_handle(chat_client, "alicehandle")
    await _switch_user(chat_client, "bob@example.com")
    await _set_handle(chat_client, "bobhandle")
    friendship_id = await _befriend(
        chat_client, "bob@example.com", "alice@example.com", "alicehandle"
    )

    await _relogin(chat_client, "alice@example.com")
    message = await _send_invite(chat_client, friendship_id)
    invite_id = message["invite"]["id"]

    bob_id = await _user_id(session_maker, "bob@example.com")
    async with session_maker() as session:
        user = await session.get(User, bob_id)
        assert user is not None
        await session.delete(user)
        await session.commit()

    async with session_maker() as session:
        assert await session.get(DuelInvite, uuid.UUID(invite_id)) is None
