"""Head-to-head duel record tests (plan: h2h-duel-history).

Covers h2h_record(session, me_id, opponent_id) service function and
GET /duel/rooms/{room_id}/h2h endpoint. Reuses duel test helpers.
"""

import secrets
import uuid
from datetime import datetime, timezone

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Solve, User
from app.models.duel import DuelRoom
from app.services import duel as duel_service
from tests.conftest import EmailSpy


# --------- Test setup fixtures and helpers --------- #


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    """Log out the current user (drop cookies) and log in a fresh one."""
    client.cookies.clear()
    await _register_and_login(client, email)


async def _relogin(client: AsyncClient, email: str) -> None:
    """Drop cookies and log back in as an ALREADY-registered user."""
    client.cookies.clear()
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


async def _create_test_users(session: AsyncSession, *emails: str) -> list[uuid.UUID]:
    """Create test users and return their IDs."""
    user_ids = []
    for email in emails:
        user_id = uuid.uuid4()
        session.add(User(id=user_id, email=email, hashed_password="hash"))
        user_ids.append(user_id)
    await session.flush()
    return user_ids


# --------- h2h_record service tests --------- #


async def test_h2h_record_mixed_winners(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """h2h_record with A wins, B wins, draw via winner_id=None."""
    async with session_maker() as session:
        # Create users first (FK requirement)
        a_id, b_id = await _create_test_users(session, "a@test.com", "b@test.com")

        # Create A-wins room
        room1 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room1)

        # Create B-wins room
        room2 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=b_id,
        )
        session.add(room2)

        # Create draw room
        room3 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=None,
        )
        session.add(room3)

        await session.flush()

        # Test A vs B
        counts_a_b = await duel_service.h2h_record(session, a_id, b_id)
        assert counts_a_b.played == 3
        assert counts_a_b.your_wins == 1  # A won room1
        assert counts_a_b.opponent_wins == 1  # B won room2
        assert counts_a_b.draws == 1  # room3 is a draw

        # Test B vs A (swapped wins, same played/draws)
        counts_b_a = await duel_service.h2h_record(session, b_id, a_id)
        assert counts_b_a.played == 3
        assert counts_b_a.your_wins == 1  # B won room2
        assert counts_b_a.opponent_wins == 1  # A won room1
        assert counts_b_a.draws == 1


async def test_h2h_record_abandoned_excluded(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Abandoned rooms are not counted."""
    async with session_maker() as session:
        a_id, b_id = await _create_test_users(session, "a@test.com", "b@test.com")

        # Create a finished room
        room1 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room1)

        # Create an abandoned room
        room2 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="abandoned",
            winner_id=None,
        )
        session.add(room2)

        await session.flush()

        counts = await duel_service.h2h_record(session, a_id, b_id)
        assert counts.played == 1  # only room1
        assert counts.your_wins == 1


async def test_h2h_record_non_finished_excluded(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Open, full, and active rooms are not counted."""
    async with session_maker() as session:
        a_id, b_id = await _create_test_users(session, "a@test.com", "b@test.com")

        # Create a finished room
        room_finished = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room_finished)

        # Create open room
        room_open = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=None,
            mode="fast",
            event="333",
            status="open",
            winner_id=None,
        )
        session.add(room_open)

        # Create full room
        room_full = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="full",
            winner_id=None,
        )
        session.add(room_full)

        # Create active room
        room_active = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="active",
            winner_id=None,
        )
        session.add(room_active)

        await session.flush()

        counts = await duel_service.h2h_record(session, a_id, b_id)
        assert counts.played == 1  # only room_finished
        assert counts.your_wins == 1


async def test_h2h_record_third_user_excluded(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Third-user rooms (A-C, B-C) don't affect A-B counts."""
    async with session_maker() as session:
        a_id, b_id, c_id = await _create_test_users(
            session, "a@test.com", "b@test.com", "c@test.com"
        )

        # A-B rooms
        room_ab = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room_ab)

        # A-C rooms (should not affect A-B)
        room_ac = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=c_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room_ac)

        # B-C rooms (should not affect A-B)
        room_bc = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=b_id,
            player_b_id=c_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=b_id,
        )
        session.add(room_bc)

        await session.flush()

        counts = await duel_service.h2h_record(session, a_id, b_id)
        assert counts.played == 1  # only room_ab
        assert counts.your_wins == 1
        assert counts.opponent_wins == 0
        assert counts.draws == 0


async def test_h2h_record_rematch_child_counted(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Rematch child rooms are counted like any other finished room."""
    async with session_maker() as session:
        a_id, b_id = await _create_test_users(session, "a@test.com", "b@test.com")
        parent_room_id = uuid.uuid4()

        # Create parent room (finished)
        parent = DuelRoom(
            id=parent_room_id,
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(parent)

        # Create rematch child room (also finished, different id)
        child = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=b_id,
            parent_room_id=parent_room_id,
        )
        session.add(child)

        await session.flush()

        counts = await duel_service.h2h_record(session, a_id, b_id)
        assert counts.played == 2  # both parent and child counted
        assert counts.your_wins == 1  # A won parent
        assert counts.opponent_wins == 1  # B won child
        assert counts.draws == 0


async def test_h2h_record_slot_symmetry(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Slot symmetry: one room with A as player_a, another with A as player_b."""
    async with session_maker() as session:
        a_id, b_id = await _create_test_users(session, "a@test.com", "b@test.com")

        # Room 1: A is player_a, B is player_b
        room1 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room1)

        # Room 2: A is player_b, B is player_a (swapped)
        room2 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=b_id,
            player_b_id=a_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
        )
        session.add(room2)

        await session.flush()

        counts = await duel_service.h2h_record(session, a_id, b_id)
        assert counts.played == 2
        assert counts.your_wins == 2  # A won both
        assert counts.opponent_wins == 0
        assert counts.draws == 0


# --------- GET /duel/rooms/{room_id}/h2h endpoint tests --------- #


async def test_h2h_endpoint_anon_401(client: AsyncClient) -> None:
    """Anon caller gets 401."""
    fake_room_id = uuid.uuid4()
    resp = await client.get(f"/duel/rooms/{fake_room_id}/h2h")
    assert resp.status_code == 401, resp.text


async def test_h2h_endpoint_unknown_room_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Unknown room_id gives 404."""
    await _register_and_login(client, "user@example.com")
    fake_room_id = uuid.uuid4()
    resp = await client.get(f"/duel/rooms/{fake_room_id}/h2h")
    assert resp.status_code == 404, resp.text


async def test_h2h_endpoint_non_participant_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Non-participant gets 404."""
    # Create room with creator + joiner
    await _register_and_login(client, "creator@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = resp.json()["room_id"]

    await _switch_user(client, "joiner@example.com")
    resp = await client.post(f"/duel/join/{resp.json()['invite_token']}")
    assert resp.status_code == 200

    # Try to access as a third user
    await _switch_user(client, "stranger@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/h2h")
    assert resp.status_code == 404, resp.text


async def test_h2h_endpoint_no_opponent_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Open room (player_b_id NULL) returns 404."""
    await _register_and_login(client, "creator@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = resp.json()["room_id"]

    # Creator tries to fetch h2h from their own room before anyone joins
    resp = await client.get(f"/duel/rooms/{room_id}/h2h")
    assert resp.status_code == 404, resp.text


async def test_h2h_endpoint_happy_path(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """A and B play finished rooms; A GETs and wins are correct; B GETs and wins swapped."""
    await _register_and_login(client, "player_a@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = uuid.UUID(resp.json()["room_id"])
    invite_token = resp.json()["invite_token"]

    # Get player A's user_id
    async with session_maker() as session:
        player_a = (
            (await session.execute(select(User).where(User.email == "player_a@example.com")))
            .unique()
            .scalar_one()
        )
        player_a_id = player_a.id

    # Player B joins
    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

    # Get player B's user_id
    async with session_maker() as session:
        player_b = (
            (await session.execute(select(User).where(User.email == "player_b@example.com")))
            .unique()
            .scalar_one()
        )
        player_b_id = player_b.id

    # Finalize the room (A wins) and create more rooms for counts
    async with session_maker() as session:
        # Finish the current room with A winning
        room = await session.get(DuelRoom, room_id)
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

        # Add more finished rooms to test counts
        room2 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=player_a_id,
            player_b_id=player_b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=player_b_id,
        )
        session.add(room2)

        room3 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=player_b_id,
            player_b_id=player_a_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=None,
        )
        session.add(room3)
        await session.commit()

    # Player A fetches h2h
    await _relogin(client, "player_a@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/h2h")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 3
    assert data["your_wins"] == 1  # A won the first room
    assert data["opponent_wins"] == 1  # B won the second room
    assert data["draws"] == 1  # third room was a draw
    assert data["opponent_user_id"] == str(player_b_id)

    # Player B fetches h2h (should have wins swapped)
    await _relogin(client, "player_b@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/h2h")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 3
    assert data["your_wins"] == 1  # B won the second room
    assert data["opponent_wins"] == 1  # A won the first room
    assert data["draws"] == 1
    assert data["opponent_user_id"] == str(player_a_id)


async def test_h2h_endpoint_readonly(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Endpoint writes nothing: Solve count and DuelRoom rows unchanged before/after GET."""
    await _register_and_login(client, "player_a@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = uuid.UUID(resp.json()["room_id"])
    invite_token = resp.json()["invite_token"]

    # Player B joins
    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

    # Finalize the room
    async with session_maker() as session:
        room = await session.get(DuelRoom, room_id)
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

    # Count solves and rooms before GET
    async with session_maker() as session:
        solve_count_before = (await session.execute(select(func.count(Solve.id)))).scalar()
        room_count_before = (await session.execute(select(func.count(DuelRoom.id)))).scalar()

    # Fetch h2h
    await _relogin(client, "player_a@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/h2h")
    assert resp.status_code == 200

    # Count solves and rooms after GET
    async with session_maker() as session:
        solve_count_after = (await session.execute(select(func.count(Solve.id)))).scalar()
        room_count_after = (await session.execute(select(func.count(DuelRoom.id)))).scalar()

    # Verify nothing changed
    assert solve_count_before == solve_count_after == 0  # no solves written
    assert room_count_before == room_count_after == 1  # only the test room exists
