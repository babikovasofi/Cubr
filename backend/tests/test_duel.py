"""Duel REST + DB service layer (`app.routers.duel` / `app.services.duel`).

Covers `compute_winner` (pure), the room lifecycle endpoints, П11
("one active duel per user") enforcement via the `DuelParticipant`
partial-UNIQUE index, rematch idempotency, and the §П5 PB-invariant
(a duel writes zero `solves`).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Solve, User
from app.models.duel import DuelRoom
from app.models.duel_participant import DuelParticipant
from app.services import duel as duel_service
from app.services.duel import compute_winner
from tests.conftest import EmailSpy

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _login_only(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    """Log out the current user (drop cookies) and log in a fresh one."""
    client.cookies.clear()
    await _register_and_login(client, email)


async def _relogin(client: AsyncClient, email: str) -> None:
    """Drop cookies and log back in as an ALREADY-registered user."""
    client.cookies.clear()
    await _login_only(client, email)


# --------------------------------------------------------------------------- #
# compute_winner (pure)
# --------------------------------------------------------------------------- #

_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_compute_winner_smaller_valid_time_wins() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "valid", 5000, _NOW, b, "valid", 6000, _NOW) == a
    assert compute_winner(a, "valid", 9000, _NOW, b, "valid", 6000, _NOW) == b


def test_compute_winner_valid_beats_dnf() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "valid", 5000, _NOW, b, "dnf", None, _NOW) == a
    assert compute_winner(a, "dnf", None, _NOW, b, "valid", 5000, _NOW) == b


def test_compute_winner_both_dnf_is_tie() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "dnf", None, _NOW, b, "dnf", None, _NOW) is None


def test_compute_winner_both_pending_is_tie() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "pending", None, None, b, "pending", None, None) is None


def test_compute_winner_disconnect_dnf_survivor_pending_wins() -> None:
    # Opponent forced dnf (vanished during solve); survivor still "pending"
    # (match ended because opponent left, not because survivor failed).
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "pending", None, None, b, "dnf", None, _NOW) == a
    assert compute_winner(a, "dnf", None, _NOW, b, "pending", None, None) == b


def test_compute_winner_equal_valid_time_breaks_on_first_finished_at() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    a_first = _NOW
    b_later = _NOW + timedelta(seconds=1)
    assert compute_winner(a, "valid", 5000, a_first, b, "valid", 5000, b_later) == a
    assert compute_winner(a, "valid", 5000, b_later, b, "valid", 5000, a_first) == b


def test_compute_winner_fully_identical_is_tie() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert compute_winner(a, "valid", 5000, _NOW, b, "valid", 5000, _NOW) is None


# --------------------------------------------------------------------------- #
# create_room REST
# --------------------------------------------------------------------------- #


async def test_create_room_anonymous_401(client: AsyncClient) -> None:
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 401, resp.text


async def test_create_room_authed_201(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "creator@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert uuid.UUID(body["room_id"])
    assert body["invite_token"]
    assert body["session_token"]
    assert body["mode"] == "fast"
    assert body["event"] == "333"
    assert body["invite_token"] in body["join_url"]
    # Secrecy: no scramble anywhere in a REST response.
    assert "scramble" not in body


async def test_get_room_hides_scramble_and_is_participant_only(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "owner@example.com")
    room_id = (await client.post("/duel/rooms")).json()["room_id"]

    resp = await client.get(f"/duel/rooms/{room_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["your_slot"] == "a"
    assert body["opponent_present"] is False
    assert "scramble" not in body

    # A non-participant gets 404 (not 403 — existence is not leaked).
    await _switch_user(client, "stranger@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}")
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# П11 — one active duel per user (create)
# --------------------------------------------------------------------------- #


async def test_second_create_same_user_conflicts_with_existing_room_id(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "dup@example.com")
    first = (await client.post("/duel/rooms")).json()

    resp = await client.post("/duel/rooms")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["existing_room_id"] == first["room_id"]


async def test_create_allowed_again_after_previous_room_finished(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "recreate@example.com")
    created = (await client.post("/duel/rooms")).json()
    first_id = uuid.UUID(created["room_id"])
    # A real second player joins (FK-valid player_b) so finalize is realistic.
    await _switch_user(client, "recreate-guest@example.com")
    await client.post(f"/duel/join/{created['invite_token']}")

    # Finalize the first room (participant.active -> false) directly via service.
    async with session_maker() as session:
        room = await session.get(DuelRoom, first_id)
        assert room is not None
        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=5000,
            a_status="valid",
            a_verify_frames_ok=None,
            a_finished_at=_NOW,
            b_time_ms=6000,
            b_status="valid",
            b_verify_frames_ok=None,
            b_finished_at=_NOW,
        )
        await session.commit()

    # Original host can now open a fresh duel (their participant is inactive).
    await _relogin(client, "recreate@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201, resp.text
    assert resp.json()["room_id"] != str(first_id)


async def test_partial_unique_blocks_second_active_participant(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The partial-UNIQUE(user_id) WHERE active index physically forbids a
    second active participant row for the same user (this is what makes П11
    race-safe, not an app-level pre-check)."""
    await _register_and_login(client, "puniq@example.com")
    room = (await client.post("/duel/rooms")).json()

    async with session_maker() as session:
        user_id = (await session.execute(select(User.id))).scalars().first()
        assert user_id is not None
        session.add(
            DuelParticipant(user_id=user_id, room_id=uuid.UUID(room["room_id"]), active=True)
        )
        with pytest.raises(IntegrityError):
            await session.flush()


# --------------------------------------------------------------------------- #
# join
# --------------------------------------------------------------------------- #


async def test_join_second_user_takes_player_b_and_room_full(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "host@example.com")
    created = (await client.post("/duel/rooms")).json()
    invite = created["invite_token"]

    await _switch_user(client, "guest@example.com")
    resp = await client.post(f"/duel/join/{invite}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["room_id"] == created["room_id"]
    assert body["status"] == "full"
    assert body["session_token"]

    async with session_maker() as session:
        room = await session.get(DuelRoom, uuid.UUID(created["room_id"]))
        assert room is not None
        assert room.player_b_id is not None
        assert room.status == "full"


async def test_join_is_idempotent_for_existing_participant(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "host2@example.com")
    created = (await client.post("/duel/rooms")).json()
    invite = created["invite_token"]
    await _switch_user(client, "guest2@example.com")
    first = (await client.post(f"/duel/join/{invite}")).json()

    # Same guest re-joins (reconnect) -> same room, no 409.
    resp = await client.post(f"/duel/join/{invite}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["room_id"] == first["room_id"]


async def test_join_third_stranger_conflicts(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "host3@example.com")
    invite = (await client.post("/duel/rooms")).json()["invite_token"]
    await _switch_user(client, "guest3@example.com")
    assert (await client.post(f"/duel/join/{invite}")).status_code == 200
    await _switch_user(client, "third3@example.com")
    resp = await client.post(f"/duel/join/{invite}")
    assert resp.status_code == 409, resp.text


async def test_join_unknown_token_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "joiner@example.com")
    resp = await client.post("/duel/join/this-token-does-not-exist")
    assert resp.status_code == 404, resp.text


async def test_join_when_joiner_already_has_active_duel_conflicts(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    # host makes room1; guest makes their OWN room2 (active), then tries to
    # join room1 -> 409 (П11 on the joiner side).
    await _register_and_login(client, "hostx@example.com")
    invite1 = (await client.post("/duel/rooms")).json()["invite_token"]
    await _switch_user(client, "guestx@example.com")
    await client.post("/duel/rooms")  # guest now has their own active duel
    resp = await client.post(f"/duel/join/{invite1}")
    assert resp.status_code == 409, resp.text


# --------------------------------------------------------------------------- #
# rematch idempotency
# --------------------------------------------------------------------------- #


async def test_rematch_double_call_yields_single_child(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "rehost@example.com")
    created = (await client.post("/duel/rooms")).json()
    invite = created["invite_token"]
    parent_id = created["room_id"]
    await _switch_user(client, "reguest@example.com")
    await client.post(f"/duel/join/{invite}")

    # Real flow: rematch is offered only from a FINISHED room (both players'
    # participants already deactivated) — otherwise the new child's active
    # participants would collide with the still-active parent ones (П11).
    async with session_maker() as session:
        parent = await session.get(DuelRoom, uuid.UUID(parent_id))
        assert parent is not None
        await duel_service.finalize_room(
            session,
            parent,
            a_time_ms=5000,
            a_status="valid",
            a_verify_frames_ok=None,
            a_finished_at=_NOW,
            b_time_ms=6000,
            b_status="valid",
            b_verify_frames_ok=None,
            b_finished_at=_NOW,
        )
        await session.commit()

    # Both players click rematch (guest is current user; then switch back to host).
    child_1 = (await client.post(f"/duel/rooms/{parent_id}/rematch")).json()
    await _relogin(client, "rehost@example.com")  # re-login host
    child_2 = (await client.post(f"/duel/rooms/{parent_id}/rematch")).json()

    assert child_1["room_id"] == child_2["room_id"]
    async with session_maker() as session:
        n_children = await session.scalar(
            select(func.count())
            .select_from(DuelRoom)
            .where(DuelRoom.parent_room_id == uuid.UUID(parent_id))
        )
    assert n_children == 1


# --------------------------------------------------------------------------- #
# §П5 PB-invariant: a duel writes zero solves
# --------------------------------------------------------------------------- #


async def test_full_duel_flow_writes_zero_solves(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "pbhost@example.com")
    created = (await client.post("/duel/rooms")).json()
    invite = created["invite_token"]
    room_id = uuid.UUID(created["room_id"])
    await _switch_user(client, "pbguest@example.com")
    await client.post(f"/duel/join/{invite}")

    async with session_maker() as session:
        room = await session.get(DuelRoom, room_id)
        assert room is not None
        await duel_service.persist_scramble(session, room, "R U R' U'")
        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=4200,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=_NOW,
            b_time_ms=None,
            b_status="dnf",
            b_verify_frames_ok=False,
            b_finished_at=_NOW,
        )
        await session.commit()

        n_solves = await session.scalar(select(func.count()).select_from(Solve))
    assert n_solves == 0
