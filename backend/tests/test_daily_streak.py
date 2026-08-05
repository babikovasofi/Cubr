"""Daily streaks (V3): derived from finished attempts, never stored.

Load-bearing rules under test: an abandoned attempt never counts, a chain that
ended yesterday is still alive (the day is not over), and another user's
history is invisible.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import DailyAttempt, DailyChallenge, User
from app.services.streak import get_streak, streak_from_days
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"
TODAY = date(2026, 7, 28)


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == email))).unique().scalar_one()
        )
    return user.id


async def _add_day(
    session_maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    day: date,
    *,
    status: str = "valid",
    submitted: bool = True,
) -> None:
    """Give `user_id` an attempt on `day` (creating that day's challenge)."""
    async with session_maker() as session:
        daily = (
            (await session.execute(select(DailyChallenge).where(DailyChallenge.date == day)))
            .unique()
            .scalar_one_or_none()
        )
        if daily is None:
            daily = DailyChallenge(date=day, scramble="R U R' U'")
            session.add(daily)
            await session.flush()
        session.add(
            DailyAttempt(
                user_id=user_id,
                daily_id=daily.id,
                status=status,
                time_ms=12345 if status == "valid" else None,
                started_at=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
                submitted_at=(
                    datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
                    if submitted
                    else None
                ),
            )
        )
        await session.commit()


# --- pure part --------------------------------------------------------------


def test_no_days_is_all_zeroes() -> None:
    assert streak_from_days([], TODAY) == {
        "current_streak": 0,
        "best_streak": 0,
        "completed_today": False,
        "last_day": None,
    }


def test_today_only() -> None:
    out = streak_from_days([TODAY], TODAY)
    assert out["current_streak"] == 1
    assert out["best_streak"] == 1
    assert out["completed_today"] is True


def test_chain_that_ended_yesterday_is_still_alive() -> None:
    # День ещё не кончился — вчерашняя серия «под угрозой», а не сгоревшая.
    out = streak_from_days([TODAY - timedelta(days=2), TODAY - timedelta(days=1)], TODAY)
    assert out["current_streak"] == 2
    assert out["completed_today"] is False


def test_chain_older_than_yesterday_is_broken() -> None:
    out = streak_from_days([TODAY - timedelta(days=3), TODAY - timedelta(days=2)], TODAY)
    assert out["current_streak"] == 0
    assert out["best_streak"] == 2


def test_best_can_exceed_current() -> None:
    days = [
        # старая пятидневка
        TODAY - timedelta(days=20),
        TODAY - timedelta(days=19),
        TODAY - timedelta(days=18),
        TODAY - timedelta(days=17),
        TODAY - timedelta(days=16),
        # разрыв, потом свежая двухдневка
        TODAY - timedelta(days=1),
        TODAY,
    ]
    out = streak_from_days(days, TODAY)
    assert out["current_streak"] == 2
    assert out["best_streak"] == 5


# --- database + route -------------------------------------------------------


async def test_route_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/daily/streak")).status_code == 401


async def test_route_reports_three_day_streak(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "streak@example.com")
    user_id = await _user_id(session_maker, "streak@example.com")
    today = datetime.now(timezone.utc).date()
    for offset in (2, 1, 0):
        await _add_day(session_maker, user_id, today - timedelta(days=offset))

    body = (await client.get("/daily/streak")).json()
    assert body["current_streak"] == 3
    assert body["best_streak"] == 3
    assert body["completed_today"] is True
    assert body["last_day"] == today.isoformat()


async def test_abandoned_attempt_does_not_count(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "abandon@example.com")
    user_id = await _user_id(session_maker, "abandon@example.com")
    today = datetime.now(timezone.utc).date()
    # Брошенная попытка: свип добил её в dnf, но человек ничего не отправлял.
    await _add_day(session_maker, user_id, today, status="dnf", submitted=False)

    body = (await client.get("/daily/streak")).json()
    assert body["current_streak"] == 0
    assert body["best_streak"] == 0

    # А честный DNF (человек отправил) — считается.
    await _add_day(session_maker, user_id, today - timedelta(days=1), status="dnf")
    body = (await client.get("/daily/streak")).json()
    assert body["current_streak"] == 1
    assert body["completed_today"] is False


async def test_other_users_history_is_invisible(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "mine@example.com")
    mine = await _user_id(session_maker, "mine@example.com")

    resp = await client.post(
        "/auth/register", json={"email": "theirs@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 201
    theirs = await _user_id(session_maker, "theirs@example.com")

    today = datetime.now(timezone.utc).date()
    for offset in (1, 0):
        await _add_day(session_maker, theirs, today - timedelta(days=offset))
    await _add_day(session_maker, mine, today)

    body = (await client.get("/daily/streak")).json()
    assert body["current_streak"] == 1


async def test_service_accepts_injected_clock(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "clock@example.com")
    user_id = await _user_id(session_maker, "clock@example.com")
    await _add_day(session_maker, user_id, date(2026, 3, 10))
    await _add_day(session_maker, user_id, date(2026, 3, 11))

    async with session_maker() as session:
        frozen = datetime(2026, 3, 11, 12, 0, tzinfo=timezone.utc)
        out = await get_streak(session, user_id, now=frozen)
    assert out["current_streak"] == 2
    assert out["today"] == date(2026, 3, 11)
