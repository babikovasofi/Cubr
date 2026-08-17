"""Running-series duel score tests (plan: rematch-series).

Covers the pure `series_chain`/`tally_series` functions, the async
`series_record` aggregate, GET /duel/rooms/{room_id}/series, and the
`rematch()` guard against a non-finished parent (skeptic HIGH fix bundled
into the same plan). Reuses the h2h test file's helper shape.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

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
_GAP = 3600


def _room(
    *,
    id: uuid.UUID | None = None,
    player_a_id: uuid.UUID,
    player_b_id: uuid.UUID | None,
    status: str = "finished",
    winner_id: uuid.UUID | None = None,
    parent_room_id: uuid.UUID | None = None,
    created_at: datetime = _NOW,
    finished_at: datetime | None = _NOW,
) -> DuelRoom:
    """Build a standalone (never flushed) DuelRoom for the pure `series_chain`/
    `tally_series` tests — no DB round trip needed, they only read attributes.
    """
    return DuelRoom(
        id=id if id is not None else uuid.uuid4(),
        invite_token=secrets.token_urlsafe(24),
        mode="fast",
        event="333",
        status=status,
        player_a_id=player_a_id,
        player_b_id=player_b_id,
        winner_id=winner_id,
        parent_room_id=parent_room_id,
        created_at=created_at,
        finished_at=finished_at,
    )


# --------- series_chain (pure) --------- #


def test_series_chain_single_room_no_parent() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    room = _room(player_a_id=a, player_b_id=b)
    chain = duel_service.series_chain({room.id: room}, room.id, _GAP)
    assert chain == [room]


def test_series_chain_three_rooms_ascend_and_stop_at_query_point() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    t0, t1, t2 = _NOW, _NOW + timedelta(minutes=10), _NOW + timedelta(minutes=20)
    room_a = _room(
        player_a_id=a, player_b_id=b, created_at=t0, finished_at=t0 + timedelta(minutes=5)
    )
    room_b = _room(
        player_a_id=a,
        player_b_id=b,
        parent_room_id=room_a.id,
        created_at=t1,
        finished_at=t1 + timedelta(minutes=5),
    )
    room_c = _room(
        player_a_id=a, player_b_id=b, parent_room_id=room_b.id, created_at=t2, finished_at=t2
    )
    rooms_by_id = {room_a.id: room_a, room_b.id: room_b, room_c.id: room_c}

    chain_from_c = duel_service.series_chain(rooms_by_id, room_c.id, _GAP)
    assert [r.id for r in chain_from_c] == [room_a.id, room_b.id, room_c.id]

    # D2: querying from the middle does NOT pull in the descendant.
    chain_from_b = duel_service.series_chain(rooms_by_id, room_b.id, _GAP)
    assert [r.id for r in chain_from_b] == [room_a.id, room_b.id]


def test_series_chain_gap_breaks_chain() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    parent = _room(player_a_id=a, player_b_id=b, finished_at=_NOW)
    child = _room(
        player_a_id=a,
        player_b_id=b,
        parent_room_id=parent.id,
        created_at=_NOW + timedelta(seconds=_GAP + 1),
    )
    rooms_by_id = {parent.id: parent, child.id: child}
    chain = duel_service.series_chain(rooms_by_id, child.id, _GAP)
    assert chain == [child]


def test_series_chain_gap_exactly_at_boundary_does_not_break() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    parent = _room(player_a_id=a, player_b_id=b, finished_at=_NOW)
    child = _room(
        player_a_id=a,
        player_b_id=b,
        parent_room_id=parent.id,
        created_at=_NOW + timedelta(seconds=_GAP),  # exactly == gap, strict > required to break
    )
    rooms_by_id = {parent.id: parent, child.id: child}
    chain = duel_service.series_chain(rooms_by_id, child.id, _GAP)
    assert [r.id for r in chain] == [parent.id, child.id]


def test_series_chain_abandoned_parent_falls_back_to_created_at() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    parent = _room(
        player_a_id=a, player_b_id=b, status="abandoned", finished_at=None, created_at=_NOW
    )
    child = _room(
        player_a_id=a,
        player_b_id=b,
        parent_room_id=parent.id,
        created_at=_NOW + timedelta(minutes=1),  # well within the gap of created_at
    )
    rooms_by_id = {parent.id: parent, child.id: child}
    chain = duel_service.series_chain(rooms_by_id, child.id, _GAP)
    assert [r.id for r in chain] == [parent.id, child.id]


def test_series_chain_naive_and_aware_datetimes_agree() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    naive_now = _NOW.replace(tzinfo=None)
    parent = _room(player_a_id=a, player_b_id=b, finished_at=naive_now)
    child = _room(
        player_a_id=a,
        player_b_id=b,
        parent_room_id=parent.id,
        created_at=(naive_now + timedelta(minutes=1)),
    )
    rooms_by_id = {parent.id: parent, child.id: child}
    chain = duel_service.series_chain(rooms_by_id, child.id, _GAP)
    assert [r.id for r in chain] == [parent.id, child.id]


def test_series_chain_missing_parent_stops_cleanly() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    orphan_parent_id = uuid.uuid4()
    child = _room(player_a_id=a, player_b_id=b, parent_room_id=orphan_parent_id)
    chain = duel_service.series_chain({child.id: child}, child.id, _GAP)
    assert chain == [child]


def test_series_chain_cycle_guard() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    room1_id, room2_id = uuid.uuid4(), uuid.uuid4()
    # Synthetic cycle: room1.parent -> room2, room2.parent -> room1.
    room1 = _room(id=room1_id, player_a_id=a, player_b_id=b, parent_room_id=room2_id)
    room2 = _room(id=room2_id, player_a_id=a, player_b_id=b, parent_room_id=room1_id)
    rooms_by_id = {room1_id: room1, room2_id: room2}
    chain = duel_service.series_chain(rooms_by_id, room1_id, _GAP)
    # Must terminate and contain each room at most once.
    assert len(chain) == len(set(r.id for r in chain))
    assert room1_id in [r.id for r in chain]


def test_series_chain_different_pair_breaks_chain() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    stranger_parent = _room(player_a_id=a, player_b_id=c)  # different pair (a, c) not (a, b)
    child = _room(player_a_id=a, player_b_id=b, parent_room_id=stranger_parent.id)
    rooms_by_id = {stranger_parent.id: stranger_parent, child.id: child}
    chain = duel_service.series_chain(rooms_by_id, child.id, _GAP)
    assert chain == [child]


# --------- tally_series (pure) --------- #


def test_tally_series_mixed_wins() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    chain = [
        _room(player_a_id=a, player_b_id=b, winner_id=a),
        _room(player_a_id=a, player_b_id=b, winner_id=a),
        _room(player_a_id=a, player_b_id=b, winner_id=b),
    ]
    counts = duel_service.tally_series(chain, a, b)
    assert (counts.played, counts.your_wins, counts.opponent_wins, counts.draws) == (3, 2, 1, 0)


def test_tally_series_none_winner_is_draw() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    chain = [_room(player_a_id=a, player_b_id=b, winner_id=None)]
    counts = duel_service.tally_series(chain, a, b)
    assert (counts.played, counts.your_wins, counts.opponent_wins, counts.draws) == (1, 0, 0, 1)


def test_tally_series_stray_winner_counts_as_played_only() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    chain = [_room(player_a_id=a, player_b_id=b, winner_id=c)]
    counts = duel_service.tally_series(chain, a, b)
    assert (counts.played, counts.your_wins, counts.opponent_wins, counts.draws) == (1, 0, 0, 0)


def test_tally_series_abandoned_room_skipped_but_does_not_block_later_games() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    chain = [
        _room(player_a_id=a, player_b_id=b, winner_id=a),
        _room(player_a_id=a, player_b_id=b, status="abandoned", winner_id=None),
        _room(player_a_id=a, player_b_id=b, winner_id=b),
    ]
    counts = duel_service.tally_series(chain, a, b)
    assert (counts.played, counts.your_wins, counts.opponent_wins, counts.draws) == (2, 1, 1, 0)


def test_tally_series_slot_symmetry() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    chain = [
        _room(player_a_id=a, player_b_id=b, winner_id=a),
        _room(player_a_id=b, player_b_id=a, winner_id=a),  # swapped slots, A still won
    ]
    counts = duel_service.tally_series(chain, a, b)
    assert (counts.played, counts.your_wins, counts.opponent_wins, counts.draws) == (2, 2, 0, 0)


# --------- GET /duel/rooms/{room_id}/series endpoint --------- #


async def test_series_endpoint_anon_401(client: AsyncClient) -> None:
    fake_room_id = uuid.uuid4()
    resp = await client.get(f"/duel/rooms/{fake_room_id}/series")
    assert resp.status_code == 401, resp.text


async def test_series_endpoint_unknown_room_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "user@example.com")
    fake_room_id = uuid.uuid4()
    resp = await client.get(f"/duel/rooms/{fake_room_id}/series")
    assert resp.status_code == 404, resp.text


async def test_series_endpoint_non_participant_404(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "creator@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = resp.json()["room_id"]
    invite_token = resp.json()["invite_token"]

    await _switch_user(client, "joiner@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

    await _switch_user(client, "stranger@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/series")
    assert resp.status_code == 404, resp.text


async def test_series_endpoint_no_opponent_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "creator@example.com")
    resp = await client.post("/duel/rooms")
    assert resp.status_code == 201
    room_id = resp.json()["room_id"]
    resp = await client.get(f"/duel/rooms/{room_id}/series")
    assert resp.status_code == 404, resp.text


async def test_series_endpoint_happy_path_with_rematches(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Root game + two rematches, all finished: series says 3 games."""
    await _register_and_login(client, "player_a@example.com")
    created = (await client.post("/duel/rooms")).json()
    room_id = uuid.UUID(created["room_id"])
    invite_token = created["invite_token"]

    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

    async with session_maker() as session:
        player_a = (
            (await session.execute(select(User).where(User.email == "player_a@example.com")))
            .unique()
            .scalar_one()
        )
        player_b = (
            (await session.execute(select(User).where(User.email == "player_b@example.com")))
            .unique()
            .scalar_one()
        )
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

    # Rematch #1
    resp = await client.post(f"/duel/rooms/{room_id}/rematch")
    assert resp.status_code == 201, resp.text
    child1_id = uuid.UUID(resp.json()["room_id"])
    async with session_maker() as session:
        child1 = await session.get(DuelRoom, child1_id)
        assert child1 is not None
        await duel_service.finalize_room(
            session,
            child1,
            a_time_ms=4000,
            a_status="valid",
            a_verify_frames_ok=None,
            a_finished_at=_NOW,
            b_time_ms=9000,
            b_status="valid",
            b_verify_frames_ok=None,
            b_finished_at=_NOW,
        )
        await session.commit()

    # Rematch #2
    resp = await client.post(f"/duel/rooms/{child1_id}/rematch")
    assert resp.status_code == 201, resp.text
    child2_id = uuid.UUID(resp.json()["room_id"])
    async with session_maker() as session:
        child2 = await session.get(DuelRoom, child2_id)
        assert child2 is not None
        await duel_service.finalize_room(
            session,
            child2,
            a_time_ms=None,
            a_status="dnf",
            a_verify_frames_ok=None,
            a_finished_at=_NOW,
            b_time_ms=7000,
            b_status="valid",
            b_verify_frames_ok=None,
            b_finished_at=_NOW,
        )
        await session.commit()

    resp = await client.get(f"/duel/rooms/{child2_id}/series")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 3
    # A won room 1 (player_a), lost child1 (b won), lost child2 (b won).
    assert data["your_wins"] + data["opponent_wins"] + data["draws"] == data["played"]
    assert set(data.keys()) == {"played", "your_wins", "opponent_wins", "draws"}, (
        "series response must carry exactly these four counters — no identifier of any kind (§П10)"
    )
    body_text = resp.text
    assert str(player_a.id) not in body_text
    assert str(player_b.id) not in body_text
    assert "player_a@example.com" not in body_text
    assert "player_b@example.com" not in body_text


async def test_series_endpoint_abandoned_link_not_counted_in_played(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Opponent abandons the rematch, but the pair plays a THIRD room continuing the
    chain from the abandoned one — abandoned link doesn't count, doesn't break chain."""
    await _register_and_login(client, "player_a@example.com")
    created = (await client.post("/duel/rooms")).json()
    room_id = uuid.UUID(created["room_id"])
    invite_token = created["invite_token"]

    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

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

    resp = await client.post(f"/duel/rooms/{room_id}/rematch")
    assert resp.status_code == 201, resp.text
    child_id = uuid.UUID(resp.json()["room_id"])
    async with session_maker() as session:
        child = await session.get(DuelRoom, child_id)
        assert child is not None
        await duel_service.abandon_room(session, child, now=_NOW)
        await session.commit()

    resp = await client.get(f"/duel/rooms/{child_id}/series")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 1  # only the root game — abandoned rematch not counted


async def test_series_endpoint_gap_starts_new_series(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """A rematch created long after the previous game's end starts played == 1."""
    await _register_and_login(client, "player_a@example.com")
    await _switch_user(client, "player_b@example.com")

    async with session_maker() as session:
        a_id = (
            (await session.execute(select(User).where(User.email == "player_a@example.com")))
            .unique()
            .scalar_one()
        ).id
        b_id = (
            (await session.execute(select(User).where(User.email == "player_b@example.com")))
            .unique()
            .scalar_one()
        ).id
        parent = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=a_id,
            created_at=_NOW,
            finished_at=_NOW,
        )
        session.add(parent)
        await session.flush()
        child = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=b_id,
            parent_room_id=parent.id,
            created_at=_NOW
            + timedelta(seconds=7200),  # 2h later, well past DUEL_SERIES_GAP_SECONDS
            finished_at=_NOW + timedelta(seconds=7200),
        )
        session.add(child)
        await session.flush()
        child_id = child.id
        await session.commit()

    await _relogin(client, "player_a@example.com")
    resp = await client.get(f"/duel/rooms/{child_id}/series")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 1  # gap broke the chain — new series of one game


async def test_series_endpoint_draw_not_inflating_wins(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "player_a@example.com")
    await _switch_user(client, "player_b@example.com")

    async with session_maker() as session:
        a_id = (
            (await session.execute(select(User).where(User.email == "player_a@example.com")))
            .unique()
            .scalar_one()
        ).id
        b_id = (
            (await session.execute(select(User).where(User.email == "player_b@example.com")))
            .unique()
            .scalar_one()
        ).id
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
        await session.flush()
        room2 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=None,
            parent_room_id=room1.id,
        )
        session.add(room2)
        await session.flush()
        room3 = DuelRoom(
            invite_token=secrets.token_urlsafe(24),
            player_a_id=a_id,
            player_b_id=b_id,
            mode="fast",
            event="333",
            status="finished",
            winner_id=None,
            parent_room_id=room2.id,
        )
        session.add(room3)
        await session.flush()
        room3_id = room3.id
        await session.commit()

    await _relogin(client, "player_a@example.com")
    resp = await client.get(f"/duel/rooms/{room3_id}/series")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["played"] == 3
    assert data["your_wins"] == 1
    assert data["opponent_wins"] == 0
    assert data["draws"] == 2


async def test_series_endpoint_readonly(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """§П5 guard: the GET writes nothing — Solve count and DuelRoom count unchanged."""
    await _register_and_login(client, "player_a@example.com")
    created = (await client.post("/duel/rooms")).json()
    room_id = uuid.UUID(created["room_id"])
    invite_token = created["invite_token"]

    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200

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

    async with session_maker() as session:
        solve_count_before = (await session.execute(select(func.count(Solve.id)))).scalar()
        room_count_before = (await session.execute(select(func.count(DuelRoom.id)))).scalar()

    await _relogin(client, "player_a@example.com")
    resp = await client.get(f"/duel/rooms/{room_id}/series")
    assert resp.status_code == 200

    async with session_maker() as session:
        solve_count_after = (await session.execute(select(func.count(Solve.id)))).scalar()
        room_count_after = (await session.execute(select(func.count(DuelRoom.id)))).scalar()

    assert solve_count_before == solve_count_after == 0
    assert room_count_before == room_count_after == 1


# --------- rematch() guard against a non-finished parent (skeptic HIGH fix) --------- #


async def test_rematch_against_non_finished_parent_is_clean_404(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """A rematch clicked against a still-open/full/active parent must not 500
    (the child's participant inserts would collide with the partial-UNIQUE
    (user_id WHERE active) index) — it 404s cleanly instead.
    """
    await _register_and_login(client, "player_a@example.com")
    created = (await client.post("/duel/rooms")).json()
    room_id = created["room_id"]
    invite_token = created["invite_token"]

    await _switch_user(client, "player_b@example.com")
    resp = await client.post(f"/duel/join/{invite_token}")
    assert resp.status_code == 200  # room is now "full", NOT finished

    resp = await client.post(f"/duel/rooms/{room_id}/rematch")
    assert resp.status_code == 404, resp.text

    async with session_maker() as session:
        n_children = await session.scalar(
            select(func.count())
            .select_from(DuelRoom)
            .where(DuelRoom.parent_room_id == uuid.UUID(room_id))
        )
    assert n_children == 0  # no partial child row left behind
