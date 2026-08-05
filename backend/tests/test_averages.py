"""Ao5 (WCA-style) — the setter `users.best_ao5_ms` never had until now.

The rules cubers will notice immediately if they are wrong: best and worst are
dropped, ONE DNF is just the dropped worst, TWO DNFs make the average a DNF.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import uuid
from datetime import datetime, timedelta, timezone

from app.models import Solve, User
from app.services.averages import ao5, current_ao5
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def _post_solve(client: AsyncClient, time_ms: int, status: str = "valid") -> None:
    resp = await client.post(
        "/solves",
        json={"scramble": "R U R' U'", "time_ms": time_ms, "status": status},
    )
    assert resp.status_code == 201, resp.text


async def _best_ao5(session_maker: async_sessionmaker[AsyncSession], email: str) -> int | None:
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == email))).unique().scalar_one()
        )
    return user.best_ao5_ms


# --- pure rules -------------------------------------------------------------


def test_drops_best_and_worst() -> None:
    # 10,20,30,40,50 -> считаются 20,30,40
    assert ao5([10_000, 20_000, 30_000, 40_000, 50_000]) == 30_000


def test_single_dnf_is_the_dropped_worst() -> None:
    # DNF выбрасывается как худшая, лучшая (10) тоже — остаются 20,30,40.
    assert ao5([None, 10_000, 20_000, 30_000, 40_000]) == 30_000


def test_two_dnfs_make_the_average_a_dnf() -> None:
    assert ao5([None, None, 20_000, 30_000, 40_000]) is None


@pytest.mark.parametrize("count", [0, 1, 4, 6])
def test_wrong_window_size_has_no_average(count: int) -> None:
    assert ao5([12_000] * count) is None


def test_rounds_to_whole_milliseconds() -> None:
    assert ao5([10_000, 10_001, 10_002, 10_004, 99_000]) == 10_002


# --- through the API --------------------------------------------------------


async def test_four_solves_are_not_enough_for_an_average(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-few@example.com")
    for ms in (20_000, 21_000, 22_000, 23_000):
        await _post_solve(client, ms)

    assert await _best_ao5(session_maker, "ao5-few@example.com") is None


async def test_fifth_solve_sets_best_ao5(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5@example.com")
    for ms in (20_000, 21_000, 22_000, 23_000, 24_000):
        await _post_solve(client, ms)

    # Отброшены 20 и 24 -> (21+22+23)/3.
    assert await _best_ao5(session_maker, "ao5@example.com") == 22_000

    body = (await client.get("/users/me")).json()
    assert body["best_ao5_ms"] == 22_000


async def _insert_solves(
    session_maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    entries: list[tuple[int, str]],
    start: datetime,
) -> None:
    """Прямая вставка с ЯВНЫМИ created_at.

    Через API так нельзя: sqlite хранит `created_at` с точностью до секунды, и
    пять сборок, отправленных подряд, ложатся в одну и ту же метку — окно
    «последние пять» становится недетерминированным. В проде (Postgres,
    микросекунды) этого нет, но тест должен проверять правило, а не разрешение
    часов.
    """
    async with session_maker() as session:
        for i, (time_ms, status) in enumerate(entries):
            session.add(
                Solve(
                    user_id=user_id,
                    scramble="R U R' U'",
                    time_ms=time_ms,
                    status=status,
                    created_at=start + timedelta(minutes=i),
                )
            )
        await session.commit()


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == email))).unique().scalar_one()
        )
    return user.id


async def test_rolling_window_takes_the_five_most_recent(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-window@example.com")
    user_id = await _user_id(session_maker, "ao5-window@example.com")
    start = datetime(2026, 7, 28, 9, 0, tzinfo=timezone.utc)
    # Две старые быстрые + пять свежих медленных: окно видит только свежие.
    await _insert_solves(
        session_maker,
        user_id,
        [
            (10_000, "valid"),
            (11_000, "valid"),
            (50_000, "valid"),
            (51_000, "valid"),
            (52_000, "valid"),
            (53_000, "valid"),
            (54_000, "valid"),
        ],
        start,
    )

    async with session_maker() as session:
        # 50..54 -> отброшены 50 и 54 -> (51+52+53)/3.
        assert await current_ao5(session, user_id) == 52_000


async def test_rejected_solves_are_skipped_not_treated_as_dnf(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-rejected@example.com")
    user_id = await _user_id(session_maker, "ao5-rejected@example.com")
    start = datetime(2026, 7, 28, 9, 0, tzinfo=timezone.utc)
    # Отклонённая сборка — не попытка: окно берёт пять валидных вокруг неё,
    # а не считает её DNF-ом (иначе среднее было бы испорчено).
    await _insert_solves(
        session_maker,
        user_id,
        [
            (20_000, "valid"),
            (21_000, "valid"),
            (99_000, "rejected"),
            (22_000, "valid"),
            (23_000, "valid"),
            (24_000, "valid"),
        ],
        start,
    )

    async with session_maker() as session:
        assert await current_ao5(session, user_id) == 22_000


async def test_best_ao5_only_improves(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-improve@example.com")
    for ms in (20_000, 21_000, 22_000, 23_000, 24_000):
        await _post_solve(client, ms)
    assert await _best_ao5(session_maker, "ao5-improve@example.com") == 22_000

    # Пять медленных подряд: текущий Ao5 хуже — рекорд не портится.
    for ms in (50_000, 51_000, 52_000, 53_000, 54_000):
        await _post_solve(client, ms)
    assert await _best_ao5(session_maker, "ao5-improve@example.com") == 22_000


async def test_one_dnf_does_not_ruin_the_average_through_the_api(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-dnf@example.com")
    for ms in (21_000, 22_000, 23_000, 40_000):
        await _post_solve(client, ms)
    # DNF шлётся как time_ms=1 (бэк требует >0) — статус решает, не время.
    await _post_solve(client, 1, status="dnf")

    # Попытки: 21,22,23,40,DNF -> отброшены 21 и DNF -> (22+23+40)/3.
    assert await _best_ao5(session_maker, "ao5-dnf@example.com") == round(
        (22_000 + 23_000 + 40_000) / 3
    )


async def test_other_users_solves_do_not_leak_into_the_average(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, "ao5-mine@example.com")
    for ms in (20_000, 21_000, 22_000, 23_000):
        await _post_solve(client, ms)

    await _register_and_login(client, "ao5-theirs@example.com")
    await _post_solve(client, 9_000)

    assert await _best_ao5(session_maker, "ao5-mine@example.com") is None
    assert await _best_ao5(session_maker, "ao5-theirs@example.com") is None
