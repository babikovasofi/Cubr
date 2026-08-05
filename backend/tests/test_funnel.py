"""`GET /admin/funnel` (Stage 6): operator-only aggregate counters.

Two properties are load-bearing: only a superuser can read it, and the payload
carries integers only — никаких email/ников/id (П10).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import DuelParticipant, DuelRoom, Solve, User
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def _make_superuser(session_maker: async_sessionmaker[AsyncSession], email: str) -> None:
    async with session_maker() as session:
        await session.execute(update(User).where(User.email == email).values(is_superuser=True))
        await session.commit()


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == email))).unique().scalar_one()
        )
    return user.id


async def test_anonymous_gets_401(client: AsyncClient) -> None:
    resp = await client.get("/admin/funnel")
    assert resp.status_code == 401


async def test_ordinary_user_gets_403(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "plain@example.com")
    resp = await client.get("/admin/funnel")
    assert resp.status_code == 403


async def test_superuser_sees_counts(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "boss@example.com")
    await _make_superuser(session_maker, "boss@example.com")

    resp = await client.get("/admin/funnel")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["users_total"] == 1
    assert body["users_with_solve"] == 0
    assert body["users_with_duel"] == 0
    assert body["signups_7d"] == 1
    assert body["generated_at"]


async def test_counts_are_per_user_not_per_row(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "boss2@example.com")
    await _make_superuser(session_maker, "boss2@example.com")
    boss_id = await _user_id(session_maker, "boss2@example.com")

    # Две сборки одного человека — это 1 в воронке и 2 в общем счётчике.
    async with session_maker() as session:
        for time_ms in (12345, 23456):
            session.add(
                Solve(
                    user_id=boss_id,
                    scramble="R U R' U'",
                    time_ms=time_ms,
                    status="valid",
                )
            )
        await session.commit()

    body = (await client.get("/admin/funnel")).json()
    assert body["users_with_solve"] == 1
    assert body["solves_total"] == 2
    assert body["active_7d"] == 1


async def test_duel_and_finished_room_counted(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "boss3@example.com")
    await _make_superuser(session_maker, "boss3@example.com")
    boss_id = await _user_id(session_maker, "boss3@example.com")

    async with session_maker() as session:
        room = DuelRoom(status="finished", invite_token="tok-funnel-1", player_a_id=boss_id)
        session.add(room)
        await session.flush()
        session.add(DuelParticipant(user_id=boss_id, room_id=room.id, active=False))
        await session.commit()

    body = (await client.get("/admin/funnel")).json()
    assert body["users_with_duel"] == 1
    assert body["duels_finished"] == 1


async def test_old_signup_outside_the_7d_window(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "boss4@example.com")
    await _make_superuser(session_maker, "boss4@example.com")

    # Второй, «старый» аккаунт: он попадает в total, но не в окно недели.
    resp = await client.post(
        "/auth/register", json={"email": "old@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 201
    async with session_maker() as session:
        await session.execute(
            update(User)
            .where(User.email == "old@example.com")
            .values(created_at=datetime.now(timezone.utc) - timedelta(days=40))
        )
        await session.commit()

    body = (await client.get("/admin/funnel")).json()
    assert body["users_total"] == 2
    assert body["signups_7d"] == 1
    assert body["signups_30d"] == 1


@pytest.mark.parametrize("leak", ["@example.com", "boss", "nickname", "email"])
async def test_payload_carries_no_identifiers(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
    leak: str,
) -> None:
    await _register_and_login(client, "boss5@example.com")
    await _make_superuser(session_maker, "boss5@example.com")

    raw = (await client.get("/admin/funnel")).text
    assert leak not in raw
