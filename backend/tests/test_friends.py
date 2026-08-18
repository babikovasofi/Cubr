"""Mutual friends (`app.routers.friends` / `app.services.friends`).

Covers: happy path, self/handle-required/conflict error mapping, the
same-404-for-unknown-or-not-yours accept/decline/remove shape, the pair
UNIQUE+CHECK physically forbidding a mirrored or self row, no-PII in every
list response, and the per-CALLER (not per-IP) rate limit on
`POST /friends/requests`.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.models.friendship import Friendship
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 204, r.text


async def _login_only(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    """Log out the current user (drop cookies) and register+login a fresh one."""
    client.cookies.clear()
    await _register_and_login(client, email)


async def _relogin(client: AsyncClient, email: str) -> None:
    """Drop cookies and log back in as an ALREADY-registered user."""
    client.cookies.clear()
    await _login_only(client, email)


async def _set_handle(client: AsyncClient, handle: str) -> None:
    resp = await client.patch("/users/me", json={"public_handle": handle})
    assert resp.status_code == 200, resp.text


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        result = await session.execute(select(User.id).where(User.email == email))
        user_id = result.scalar_one()
    return user_id


# --------------------------------------------------------------------------- #
# happy path
# --------------------------------------------------------------------------- #


async def test_request_accept_then_both_see_friend(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "alice@example.com")
    await _set_handle(client, "alicehandle")

    await _switch_user(client, "bob@example.com")
    await _set_handle(client, "bobhandle")

    # Bob requests Alice.
    resp = await client.post("/friends/requests", json={"public_handle": "alicehandle"})
    assert resp.status_code == 201, resp.text
    friendship_id = resp.json()["friendship_id"]
    assert resp.json()["display_name"] == "alicehandle"

    outgoing = (await client.get("/friends/requests/outgoing")).json()
    assert [e["friendship_id"] for e in outgoing] == [friendship_id]

    await _relogin(client, "alice@example.com")
    incoming = (await client.get("/friends/requests/incoming")).json()
    assert [e["friendship_id"] for e in incoming] == [friendship_id]
    assert incoming[0]["display_name"] == "bobhandle"

    accept_resp = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert accept_resp.status_code == 200, accept_resp.text
    assert accept_resp.json()["display_name"] == "bobhandle"

    alice_friends = (await client.get("/friends")).json()
    assert [f["friendship_id"] for f in alice_friends] == [friendship_id]
    assert alice_friends[0]["display_name"] == "bobhandle"

    await _relogin(client, "bob@example.com")
    bob_friends = (await client.get("/friends")).json()
    assert [f["friendship_id"] for f in bob_friends] == [friendship_id]
    assert bob_friends[0]["display_name"] == "alicehandle"


# --------------------------------------------------------------------------- #
# send_request error mapping
# --------------------------------------------------------------------------- #


async def test_request_to_self_rejected(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "self@example.com")
    await _set_handle(client, "selfhandle")

    resp = await client.post("/friends/requests", json={"public_handle": "selfhandle"})
    assert resp.status_code == 422, resp.text

    async with session_maker() as session:
        count = (await session.execute(select(Friendship))).scalars().all()
    assert count == []


async def test_request_without_own_handle_403(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "target@example.com")
    await _set_handle(client, "targethandle")

    await _switch_user(client, "handleless@example.com")
    resp = await client.post("/friends/requests", json={"public_handle": "targethandle"})
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["code"] == "HANDLE_REQUIRED"


async def test_unknown_public_handle_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "seeker@example.com")
    await _set_handle(client, "seekerhandle")

    resp = await client.post("/friends/requests", json={"public_handle": "SPEEDCUBER"})
    assert resp.status_code == 404, resp.text

    # Register the target with different casing — a case-insensitive lookup
    # now finds them regardless of how the requester typed it.
    await _switch_user(client, "speedcuber@example.com")
    await _set_handle(client, "speedcuber")
    await _relogin(client, "seeker@example.com")
    resp = await client.post("/friends/requests", json={"public_handle": "SPEEDCUBER"})
    assert resp.status_code == 201, resp.text


async def test_duplicate_request_conflicts(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "dup-a@example.com")
    await _set_handle(client, "dupahandle")

    await _switch_user(client, "dup-b@example.com")
    await _set_handle(client, "dupbhandle")

    first = await client.post("/friends/requests", json={"public_handle": "dupahandle"})
    assert first.status_code == 201, first.text

    again = await client.post("/friends/requests", json={"public_handle": "dupahandle"})
    assert again.status_code == 409, again.text
    assert again.json()["detail"]["code"] == "FRIEND_ALREADY_PENDING"

    friendship_id = first.json()["friendship_id"]
    await _relogin(client, "dup-a@example.com")
    accept_resp = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert accept_resp.status_code == 200, accept_resp.text

    await _relogin(client, "dup-b@example.com")
    after_accept = await client.post("/friends/requests", json={"public_handle": "dupahandle"})
    assert after_accept.status_code == 409, after_accept.text
    assert after_accept.json()["detail"]["code"] == "FRIEND_ALREADY_FRIENDS"

    async with session_maker() as session:
        rows = (await session.execute(select(Friendship))).scalars().all()
    assert len(rows) == 1


async def test_reverse_request_auto_accepts(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "rev-a@example.com")
    await _set_handle(client, "revahandle")

    await _switch_user(client, "rev-b@example.com")
    await _set_handle(client, "revbhandle")

    # B -> A
    b_to_a = await client.post("/friends/requests", json={"public_handle": "revahandle"})
    assert b_to_a.status_code == 201, b_to_a.text

    # A -> B: mutual consent already expressed, so this auto-accepts.
    await _relogin(client, "rev-a@example.com")
    a_to_b = await client.post("/friends/requests", json={"public_handle": "revbhandle"})
    assert a_to_b.status_code == 201, a_to_b.text
    assert a_to_b.json()["friendship_id"] == b_to_a.json()["friendship_id"]

    friends = (await client.get("/friends")).json()
    assert len(friends) == 1

    async with session_maker() as session:
        rows = (await session.execute(select(Friendship))).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "accepted"


# --------------------------------------------------------------------------- #
# accept
# --------------------------------------------------------------------------- #


async def test_accept_someone_elses_request_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "own-a@example.com")
    await _set_handle(client, "ownahandle")

    await _switch_user(client, "own-b@example.com")
    await _set_handle(client, "ownbhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "ownahandle"})
    friendship_id = resp.json()["friendship_id"]

    # B (the sender) tries to accept their own outgoing request.
    self_accept = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert self_accept.status_code == 404, self_accept.text

    # A third, unrelated user tries to accept it too.
    await _switch_user(client, "own-c@example.com")
    third_accept = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert third_accept.status_code == 404, third_accept.text

    # Still pending — neither bogus accept changed anything.
    await _relogin(client, "own-a@example.com")
    incoming = (await client.get("/friends/requests/incoming")).json()
    assert [e["friendship_id"] for e in incoming] == [friendship_id]


async def test_accept_unknown_friendship_id_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "ghost@example.com")
    await _set_handle(client, "ghosthandle")

    resp = await client.post(f"/friends/requests/{uuid.uuid4()}/accept")
    assert resp.status_code == 404, resp.text


async def test_double_accept_is_idempotent_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "dbl-a@example.com")
    await _set_handle(client, "dblahandle")

    await _switch_user(client, "dbl-b@example.com")
    await _set_handle(client, "dblbhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "dblahandle"})
    friendship_id = resp.json()["friendship_id"]

    await _relogin(client, "dbl-a@example.com")
    first_accept = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert first_accept.status_code == 200, first_accept.text

    second_accept = await client.post(f"/friends/requests/{friendship_id}/accept")
    assert second_accept.status_code == 404, second_accept.text
    assert second_accept.status_code != 500


# --------------------------------------------------------------------------- #
# decline / cancel / remove
# --------------------------------------------------------------------------- #


async def test_decline_and_cancel_request(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "dec-a@example.com")
    await _set_handle(client, "decahandle")

    await _switch_user(client, "dec-b@example.com")
    await _set_handle(client, "decbhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "decahandle"})
    friendship_id = resp.json()["friendship_id"]

    # A declines the incoming request.
    await _relogin(client, "dec-a@example.com")
    decline = await client.delete(f"/friends/requests/{friendship_id}")
    assert decline.status_code == 204, decline.text
    assert (await client.get("/friends/requests/incoming")).json() == []

    await _relogin(client, "dec-b@example.com")
    assert (await client.get("/friends/requests/outgoing")).json() == []

    # A fresh request is possible again.
    resp2 = await client.post("/friends/requests", json={"public_handle": "decahandle"})
    assert resp2.status_code == 201, resp2.text
    friendship_id2 = resp2.json()["friendship_id"]

    # B (the sender) cancels their own outgoing request.
    cancel = await client.delete(f"/friends/requests/{friendship_id2}")
    assert cancel.status_code == 204, cancel.text
    assert (await client.get("/friends/requests/outgoing")).json() == []

    await _relogin(client, "dec-a@example.com")
    assert (await client.get("/friends/requests/incoming")).json() == []

    # Requestable again after the cancel too.
    resp3 = await client.post("/friends/requests", json={"public_handle": "decbhandle"})
    assert resp3.status_code == 201, resp3.text


async def test_remove_friend(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "rm-a@example.com")
    await _set_handle(client, "rmahandle")

    await _switch_user(client, "rm-b@example.com")
    await _set_handle(client, "rmbhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "rmahandle"})
    friendship_id = resp.json()["friendship_id"]

    await _relogin(client, "rm-a@example.com")
    await client.post(f"/friends/requests/{friendship_id}/accept")

    remove = await client.delete(f"/friends/{friendship_id}")
    assert remove.status_code == 204, remove.text
    assert (await client.get("/friends")).json() == []

    await _relogin(client, "rm-b@example.com")
    assert (await client.get("/friends")).json() == []

    # A fresh request is possible again.
    again = await client.post("/friends/requests", json={"public_handle": "rmahandle"})
    assert again.status_code == 201, again.text


# --------------------------------------------------------------------------- #
# no PII
# --------------------------------------------------------------------------- #


async def test_friend_list_has_no_pii(client: AsyncClient, email_spy: EmailSpy) -> None:
    # Both need a handle to REACH each other at all (send_request looks the
    # target up by handle, and requires the requester to have one too) —
    # the "Аноним" case below is B clearing their handle AFTER already
    # becoming a friend, which stays a legitimate, always-available action.
    await _register_and_login(client, "pii-a@example.com")
    await _set_handle(client, "piiahandle")

    await _switch_user(client, "pii-b@example.com")
    await _set_handle(client, "piibhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "piiahandle"})
    assert resp.status_code == 201, resp.text
    friendship_id = resp.json()["friendship_id"]
    assert resp.json()["display_name"] == "piiahandle"

    b_outgoing = (await client.get("/friends/requests/outgoing")).json()
    assert len(b_outgoing) == 1
    assert b_outgoing[0]["display_name"] == "piiahandle"

    await _relogin(client, "pii-a@example.com")
    a_incoming = (await client.get("/friends/requests/incoming")).json()
    assert a_incoming[0]["display_name"] == "piibhandle"

    await client.post(f"/friends/requests/{friendship_id}/accept")

    # B clears their handle now that they're already friends — A's view of
    # B must fall back to "Аноним", same as the tournament/daily boards.
    await _relogin(client, "pii-b@example.com")
    await _set_handle(client, "   ")
    await _relogin(client, "pii-a@example.com")
    a_friends = (await client.get("/friends")).json()
    assert a_friends[0]["display_name"] == "Аноним"

    for payload in (a_incoming, a_friends, b_outgoing):
        text = str(payload)
        assert "@" not in text  # no email
        assert "pii-a@example.com" not in text
        assert "pii-b@example.com" not in text
        for entry in payload:
            assert set(entry.keys()) <= {"friendship_id", "display_name", "since", "created_at"}


# --------------------------------------------------------------------------- #
# incoming/outgoing disjointness
# --------------------------------------------------------------------------- #


async def test_incoming_and_outgoing_are_disjoint(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "disj-a@example.com")
    await _set_handle(client, "disjahandle")

    await _switch_user(client, "disj-b@example.com")
    await _set_handle(client, "disjbhandle")
    resp = await client.post("/friends/requests", json={"public_handle": "disjahandle"})
    friendship_id = resp.json()["friendship_id"]

    b_incoming = (await client.get("/friends/requests/incoming")).json()
    b_outgoing = (await client.get("/friends/requests/outgoing")).json()
    assert b_incoming == []
    assert [e["friendship_id"] for e in b_outgoing] == [friendship_id]

    await _relogin(client, "disj-a@example.com")
    a_incoming = (await client.get("/friends/requests/incoming")).json()
    a_outgoing = (await client.get("/friends/requests/outgoing")).json()
    assert [e["friendship_id"] for e in a_incoming] == [friendship_id]
    assert a_outgoing == []

    await client.post(f"/friends/requests/{friendship_id}/accept")
    assert (await client.get("/friends/requests/incoming")).json() == []
    await _relogin(client, "disj-b@example.com")
    assert (await client.get("/friends/requests/outgoing")).json() == []


# --------------------------------------------------------------------------- #
# DB-level pair invariant
# --------------------------------------------------------------------------- #


async def test_pair_row_is_order_independent(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "pair-a@example.com")
    await _set_handle(client, "pairahandle")
    await _switch_user(client, "pair-b@example.com")
    await _set_handle(client, "pairbhandle")

    a_id = await _user_id(session_maker, "pair-a@example.com")
    b_id = await _user_id(session_maker, "pair-b@example.com")
    low, high = sorted((a_id, b_id))

    async with session_maker() as session:
        session.add(
            Friendship(user_low_id=low, user_high_id=high, requested_by_id=low, status="pending")
        )
        await session.commit()

    # Direct mirrored insert (high, low) — CHECK(user_low_id < user_high_id)
    # forbids this row from ever being stored in that order.
    async with session_maker() as session:
        session.add(
            Friendship(user_low_id=high, user_high_id=low, requested_by_id=low, status="pending")
        )
        with pytest.raises(IntegrityError):
            await session.flush()

    # Self-friendship: user_low_id == user_high_id also violates the CHECK.
    async with session_maker() as session:
        session.add(
            Friendship(user_low_id=a_id, user_high_id=a_id, requested_by_id=a_id, status="pending")
        )
        with pytest.raises(IntegrityError):
            await session.flush()


# --------------------------------------------------------------------------- #
# anon -> 401
# --------------------------------------------------------------------------- #

_ANON_ENDPOINTS = [
    ("POST", "/friends/requests"),
    ("GET", "/friends"),
    ("GET", "/friends/requests/incoming"),
    ("GET", "/friends/requests/outgoing"),
    ("POST", "/friends/requests/{id}/accept"),
    ("DELETE", "/friends/requests/{id}"),
    ("DELETE", "/friends/{id}"),
]


@pytest.mark.parametrize("method,path_template", _ANON_ENDPOINTS)
async def test_anon_gets_401_on_every_endpoint(
    client: AsyncClient, method: str, path_template: str
) -> None:
    path = path_template.format(id=uuid.uuid4())
    kwargs = {"json": {"public_handle": "whoever"}} if path == "/friends/requests" else {}
    resp = await client.request(method, path, **kwargs)
    assert resp.status_code == 401, resp.text


# --------------------------------------------------------------------------- #
# rate limiting
# --------------------------------------------------------------------------- #


async def test_friend_request_rate_limited_per_user(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    # FRIEND_REQUEST_RATE_LIMIT=10/minute, keyed by user.id — NOT by IP, so a
    # rotating X-Forwarded-For still trips it for the same logged-in caller.
    await _register_and_login(client, "rl-friend@example.com")
    await _set_handle(client, "rlfriendhandle")

    statuses = []
    for i in range(15):
        r = await client.post(
            "/friends/requests",
            json={"public_handle": f"no-such-handle-{i}"},
            headers={"X-Forwarded-For": f"10.0.{i}.{i}"},
        )
        statuses.append(r.status_code)
    assert 429 in statuses, statuses
