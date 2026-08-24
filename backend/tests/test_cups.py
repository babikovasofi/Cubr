"""Cups award engine (app.services.cups) + `/users/me` tier fields.

Covers: win/loss on every rank tier, the rank-floor clamp (302 -> 300 on
loss), draw, both-DNF/no-result (no event written), walkover win (no-show
opponent), idempotent re-finalize (no double award), the same-opponent
24h anti-farm cap, cups never going negative, and `/users/me` exposing
cups_rank/cups_floor/cups_to_next consistently with `tier_bounds`.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.cups_event import CupsEvent
from app.models.duel import DuelRoom
from app.models.user import User
from app.services import cups as cups_service
from app.services import duel as duel_service
from tests.conftest import EmailSpy

_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _create_users(session: AsyncSession, *cups: int) -> list[uuid.UUID]:
    """Create users with the given starting `cups`, return their IDs."""
    ids = []
    for i, c in enumerate(cups):
        uid = uuid.uuid4()
        session.add(User(id=uid, email=f"u{i}-{uid}@test.com", hashed_password="x", cups=c))
        ids.append(uid)
    await session.flush()
    return ids


async def _room(session: AsyncSession, a_id: uuid.UUID, b_id: uuid.UUID) -> DuelRoom:
    room = DuelRoom(
        invite_token=secrets.token_urlsafe(24),
        mode="fast",
        event="333",
        status="full",
        player_a_id=a_id,
        player_b_id=b_id,
    )
    session.add(room)
    await session.flush()
    return room


async def _finalize(
    session: AsyncSession,
    room: DuelRoom,
    *,
    a_time_ms: int | None,
    a_status: str,
    b_time_ms: int | None,
    b_status: str,
    now: datetime = _NOW,
) -> DuelRoom:
    """`finalize_room` + `award_for_finished_room`, exactly the sequence
    `app.routers.duel._on_finalize` runs (same session, no commit here —
    caller decides)."""
    room = await duel_service.finalize_room(
        session,
        room,
        a_time_ms=a_time_ms,
        a_status=a_status,
        a_verify_frames_ok=None,
        a_finished_at=now,
        b_time_ms=b_time_ms,
        b_status=b_status,
        b_verify_frames_ok=None,
        b_finished_at=now,
        now=now,
    )
    await cups_service.award_for_finished_room(session, room)
    return room


async def _events_for(session: AsyncSession, room_id: uuid.UUID) -> list[CupsEvent]:
    result = await session.execute(select(CupsEvent).where(CupsEvent.room_id == room_id))
    return list(result.scalars().all())


# --------------------------------------------------------------------------- #
# CUPS_TIERS / tier_bounds — pure
# --------------------------------------------------------------------------- #


def test_tiers_sorted_ascending_from_zero() -> None:
    floors = [t.floor for t in cups_service.CUPS_TIERS]
    assert floors == sorted(floors)
    assert floors[0] == 0


@pytest.mark.parametrize(
    "cups,rank,floor,to_next",
    [
        (0, "white", 0, 100),
        (99, "white", 0, 1),
        (100, "yellow", 100, 200),
        (299, "yellow", 100, 1),
        (300, "green", 300, 300),
        (599, "green", 300, 1),
        (600, "blue", 600, 400),
        (999, "blue", 600, 1),
        (1000, "orange", 1000, 500),
        (1499, "orange", 1000, 1),
        (1500, "red", 1500, None),
        (5000, "red", 1500, None),
    ],
)
def test_tier_bounds(cups: int, rank: str, floor: int, to_next: int | None) -> None:
    assert cups_service.tier_bounds(cups) == (rank, floor, to_next)


# --------------------------------------------------------------------------- #
# Win/loss per tier
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "cups,win_gain,loss_amount",
    [
        (50, 10, 0),
        (150, 9, 2),
        (400, 8, 4),
        (700, 7, 6),
        (1200, 6, 8),
        (1600, 5, 10),
    ],
)
async def test_win_and_loss_deltas_per_tier(
    session_maker: async_sessionmaker[AsyncSession],
    cups: int,
    win_gain: int,
    loss_amount: int,
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, cups, cups)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=5000, a_status="valid", b_time_ms=6000, b_status="valid"
        )
        await session.commit()

        winner = await session.get(User, a_id)
        loser = await session.get(User, b_id)
        assert winner is not None and loser is not None
        assert winner.cups == cups + win_gain
        assert loser.cups == cups - loss_amount

        events = {e.user_id: e for e in await _events_for(session, room.id)}
        assert events[a_id].reason == "win"
        assert events[a_id].delta == win_gain
        assert events[a_id].farm_limited is False
        assert events[b_id].reason == "loss"
        assert events[b_id].delta == -loss_amount
        assert events[a_id].cups_before == cups
        assert events[a_id].cups_after == cups + win_gain


async def test_loss_floors_at_own_tier_lower_bound(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Owner example: a player at 302 cups (green, floor 300) loses and
    would drop to 298 (raw -4) — clamped to 300, not below."""
    async with session_maker() as session:
        winner_id, loser_id = await _create_users(session, 100, 302)
        room = await _room(session, winner_id, loser_id)
        await _finalize(
            session,
            room,
            a_time_ms=5000,
            a_status="valid",
            b_time_ms=6000,
            b_status="valid",
        )
        await session.commit()

        loser = await session.get(User, loser_id)
        assert loser is not None
        assert loser.cups == 300


async def test_loss_never_goes_negative_at_white_tier(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        winner_id, loser_id = await _create_users(session, 0, 5)
        room = await _room(session, winner_id, loser_id)
        await _finalize(
            session, room, a_time_ms=5000, a_status="valid", b_time_ms=6000, b_status="valid"
        )
        await session.commit()
        loser = await session.get(User, loser_id)
        assert loser is not None
        assert loser.cups == 5  # white tier: loss_amount == 0, floor == 0 either way


# --------------------------------------------------------------------------- #
# Draw
# --------------------------------------------------------------------------- #


async def test_draw_gives_both_plus_two(session_maker: async_sessionmaker[AsyncSession]) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=5000, a_status="valid", b_time_ms=5000, b_status="valid"
        )
        await session.commit()

        a = await session.get(User, a_id)
        b = await session.get(User, b_id)
        assert a is not None and b is not None
        assert a.cups == 402
        assert b.cups == 402

        events = {e.user_id: e for e in await _events_for(session, room.id)}
        assert events[a_id].reason == "draw"
        assert events[a_id].delta == 2
        assert events[b_id].reason == "draw"
        assert events[b_id].delta == 2


# --------------------------------------------------------------------------- #
# Both no-result -> no cups, no event
# --------------------------------------------------------------------------- #


async def test_both_dnf_awards_nothing_and_writes_no_event(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=None, a_status="dnf", b_time_ms=None, b_status="dnf"
        )
        await session.commit()

        a = await session.get(User, a_id)
        b = await session.get(User, b_id)
        assert a is not None and b is not None
        assert a.cups == 400
        assert b.cups == 400
        assert await _events_for(session, room.id) == []


async def test_both_pending_awards_nothing(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=None, a_status="pending", b_time_ms=None, b_status="pending"
        )
        await session.commit()
        assert await _events_for(session, room.id) == []


async def test_abandoned_room_awards_nothing(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        room = await duel_service.abandon_room(session, room, now=_NOW)
        await cups_service.award_for_finished_room(session, room)
        await session.commit()

        a = await session.get(User, a_id)
        assert a is not None
        assert a.cups == 400
        assert await _events_for(session, room.id) == []


# --------------------------------------------------------------------------- #
# Walkover (opponent never showed at all -> pending, but wins on rank)
# --------------------------------------------------------------------------- #


async def test_walkover_win_gives_plus_four_loser_zero(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        winner_id, loser_id = await _create_users(session, 400, 400)
        room = await _room(session, winner_id, loser_id)
        # Winner never got a real result either (status "pending" — reached
        # via prep-timeout when the OTHER side never showed at all, see
        # `app.services.cups._classify`'s docstring); loser forced "dnf".
        await _finalize(
            session,
            room,
            a_time_ms=None,
            a_status="pending",
            b_time_ms=None,
            b_status="dnf",
        )
        await session.commit()

        winner = await session.get(User, winner_id)
        loser = await session.get(User, loser_id)
        assert winner is not None and loser is not None
        assert winner.cups == 404
        assert loser.cups == 400

        events = {e.user_id: e for e in await _events_for(session, room.id)}
        assert events[winner_id].reason == "walkover_win"
        assert events[winner_id].delta == 4
        assert events[loser_id].reason == "walkover_loss"
        assert events[loser_id].delta == 0


# --------------------------------------------------------------------------- #
# Idempotency: re-finalize never double-awards
# --------------------------------------------------------------------------- #


async def test_repeat_finalize_does_not_double_award(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=5000, a_status="valid", b_time_ms=6000, b_status="valid"
        )
        await session.commit()

        a_after_first = (await session.get(User, a_id)).cups  # type: ignore[union-attr]

        # `finalize_room` itself no-ops (already "finished"), but simulate a
        # retry/race calling the award step again directly against the SAME
        # already-finished room row.
        await cups_service.award_for_finished_room(session, room)
        await session.commit()

        a = await session.get(User, a_id)
        assert a is not None
        assert a.cups == a_after_first  # unchanged — no second award
        assert len(await _events_for(session, room.id)) == 2  # still exactly one row per player


async def test_repeat_finalize_via_finalize_room_is_a_full_noop(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """The realistic path: `finalize_room` called twice (retry) — its own
    `status == "finished"` guard makes the second call return early, so
    `award_for_finished_room` only ever really runs once."""
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        room = await _room(session, a_id, b_id)
        await _finalize(
            session, room, a_time_ms=5000, a_status="valid", b_time_ms=6000, b_status="valid"
        )
        await session.commit()

        room2 = await session.get(DuelRoom, room.id)
        assert room2 is not None
        await _finalize(
            session,
            room2,
            a_time_ms=1,  # different payload entirely — must be ignored
            a_status="valid",
            b_time_ms=2,
            b_status="valid",
        )
        await session.commit()

        a = await session.get(User, a_id)
        assert a is not None
        assert a.cups == 408  # 400 + 8 (green tier win), applied exactly once
        assert len(await _events_for(session, room.id)) == 2


# --------------------------------------------------------------------------- #
# Anti-farm: 3 full-value duels/24h with the same opponent, then degraded
# --------------------------------------------------------------------------- #


async def test_fourth_duel_with_same_opponent_in_24h_is_farm_limited(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        winner_id, loser_id = await _create_users(session, 400, 400)

        # Rooms 1-3 within the 24h window: full value.
        for i in range(3):
            room = await _room(session, winner_id, loser_id)
            await _finalize(
                session,
                room,
                a_time_ms=5000,
                a_status="valid",
                b_time_ms=6000,
                b_status="valid",
                now=_NOW + timedelta(minutes=i),
            )
        await session.commit()

        winner = await session.get(User, winner_id)
        loser = await session.get(User, loser_id)
        assert winner is not None and loser is not None
        assert winner.cups == 400 + 3 * 8  # green tier win, x3, unreduced
        assert loser.cups == 400 - 3 * 4  # green tier loss, x3, unreduced

        # 4th room, same opponent, well inside the 24h window: degraded.
        room4 = await _room(session, winner_id, loser_id)
        await _finalize(
            session,
            room4,
            a_time_ms=5000,
            a_status="valid",
            b_time_ms=6000,
            b_status="valid",
            now=_NOW + timedelta(minutes=10),
        )
        await session.commit()

        winner = await session.get(User, winner_id)
        loser = await session.get(User, loser_id)
        assert winner is not None and loser is not None
        assert winner.cups == 400 + 3 * 8 + 1  # farm-degraded win: +1
        assert loser.cups == 400 - 3 * 4  # farm-degraded loss: -0, unchanged

        events4 = {e.user_id: e for e in await _events_for(session, room4.id)}
        assert events4[winner_id].farm_limited is True
        assert events4[winner_id].delta == 1
        assert events4[winner_id].reason == "win"  # kind unchanged, only the amount is capped
        assert events4[loser_id].farm_limited is True
        assert events4[loser_id].delta == 0


async def test_fourth_duel_outside_24h_window_is_full_value_again(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        winner_id, loser_id = await _create_users(session, 400, 400)
        for i in range(3):
            room = await _room(session, winner_id, loser_id)
            await _finalize(
                session,
                room,
                a_time_ms=5000,
                a_status="valid",
                b_time_ms=6000,
                b_status="valid",
                now=_NOW + timedelta(minutes=i),
            )
        await session.commit()

        # 4th room, but 25 hours later — outside the rolling window.
        room4 = await _room(session, winner_id, loser_id)
        await _finalize(
            session,
            room4,
            a_time_ms=5000,
            a_status="valid",
            b_time_ms=6000,
            b_status="valid",
            now=_NOW + timedelta(hours=25),
        )
        await session.commit()

        winner = await session.get(User, winner_id)
        assert winner is not None
        assert winner.cups == 400 + 3 * 8 + 8  # full value again, window rolled off

        events4 = {e.user_id: e for e in await _events_for(session, room4.id)}
        assert events4[winner_id].farm_limited is False


async def test_farm_cap_is_per_opponent_not_global(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """3 duels vs opponent B, then a 1st-ever duel vs a DIFFERENT opponent C
    in the same window — C is unaffected by the B counter."""
    async with session_maker() as session:
        winner_id, b_id, c_id = await _create_users(session, 400, 400, 400)
        for i in range(4):  # 4 vs B: the 4th is already farm-limited
            room = await _room(session, winner_id, b_id)
            await _finalize(
                session,
                room,
                a_time_ms=5000,
                a_status="valid",
                b_time_ms=6000,
                b_status="valid",
                now=_NOW + timedelta(minutes=i),
            )
        await session.commit()

        room_c = await _room(session, winner_id, c_id)
        await _finalize(
            session,
            room_c,
            a_time_ms=5000,
            a_status="valid",
            b_time_ms=6000,
            b_status="valid",
            now=_NOW + timedelta(minutes=10),
        )
        await session.commit()

        events_c = {e.user_id: e for e in await _events_for(session, room_c.id)}
        assert events_c[winner_id].farm_limited is False
        assert events_c[winner_id].delta == 8  # full green-tier win vs a fresh opponent


async def test_draw_is_never_farm_limited(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        a_id, b_id = await _create_users(session, 400, 400)
        for i in range(4):  # 4 draws with the same opponent inside 24h
            room = await _room(session, a_id, b_id)
            await _finalize(
                session,
                room,
                a_time_ms=5000,
                a_status="valid",
                b_time_ms=5000,
                b_status="valid",
                now=_NOW + timedelta(minutes=i),
            )
        await session.commit()

        a = await session.get(User, a_id)
        assert a is not None
        assert a.cups == 400 + 4 * 2  # every draw stays +2, never degraded

        result = await session.execute(
            select(CupsEvent).where(CupsEvent.user_id == a_id).order_by(CupsEvent.created_at)
        )
        all_events = list(result.scalars().all())
        assert len(all_events) == 4
        assert all(
            e.reason == "draw" and e.delta == 2 and e.farm_limited is False for e in all_events
        )


# --------------------------------------------------------------------------- #
# /users/me exposes cups_rank/cups_floor/cups_to_next
# --------------------------------------------------------------------------- #


async def test_users_me_exposes_cups_tier_fields(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "tiershow@example.com")
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == "tiershow@example.com")))
            .unique()
            .scalar_one()
        )
        user.cups = 302
        await session.commit()

    body = (await client.get("/users/me")).json()
    assert body["cups"] == 302
    assert body["cups_rank"] == "green"
    assert body["cups_floor"] == 300
    assert body["cups_to_next"] == 298  # 600 - 302


async def test_users_me_top_tier_has_no_next(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "redrank@example.com")
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == "redrank@example.com")))
            .unique()
            .scalar_one()
        )
        user.cups = 2000
        await session.commit()

    body = (await client.get("/users/me")).json()
    assert body["cups_rank"] == "red"
    assert body["cups_floor"] == 1500
    assert body["cups_to_next"] is None
