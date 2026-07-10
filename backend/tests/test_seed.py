import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Solve, User
from app.seed import SEED_PASSWORD, SEED_USERS, seed

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seeded(session_maker: async_sessionmaker[AsyncSession]) -> list[str]:
    return await seed(session_maker)


async def test_seed_creates_verified_users(
    seeded: list[str], session_maker: async_sessionmaker[AsyncSession]
) -> None:
    assert set(seeded) == {u["email"] for u in SEED_USERS}
    async with session_maker() as s:
        users = (await s.scalars(select(User))).unique().all()
    assert len(users) == len(SEED_USERS)
    assert all(u.is_verified and u.is_active for u in users)


async def test_seed_is_idempotent(
    seeded: list[str], session_maker: async_sessionmaker[AsyncSession]
) -> None:
    # Second run creates nothing and does not error / duplicate.
    again = await seed(session_maker)
    assert again == []
    async with session_maker() as s:
        count = await s.scalar(select(func.count()).select_from(User))
    assert count == len(SEED_USERS)


async def test_seed_first_user_has_history_and_best(
    seeded: list[str], session_maker: async_sessionmaker[AsyncSession]
) -> None:
    async with session_maker() as s:
        user = await s.scalar(select(User).where(User.email == SEED_USERS[0]["email"]))
        assert user is not None
        assert user.best_single_ms == 12980  # fastest valid seed solve
        solves = (await s.scalars(select(Solve).where(Solve.user_id == user.id))).all()
    assert len(solves) == 3


async def test_seeded_user_can_login(seeded: list[str], client: AsyncClient) -> None:
    resp = await client.post(
        "/auth/login",
        data={"username": SEED_USERS[0]["email"], "password": SEED_PASSWORD},
    )
    assert resp.status_code == 204
    assert client.cookies.get("cubr_auth")
