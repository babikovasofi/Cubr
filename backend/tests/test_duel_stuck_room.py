"""Зависшая комната больше не запирает человека навсегда.

Partial-UNIQUE на `DuelParticipant` не даёт быть в двух дуэлях разом — это
инвариант П11 и он правильный. Но `find_active_room` возвращал строку как есть,
а ручки «выйти из комнаты» не существовало, поэтому замок работал без ключа:
у кого комната зависла, тот получал 409 на КАЖДУЮ попытку создать новую. Навсегда.

Зависает комната двумя способами, и оба живые: приглашение никто не открыл
(`open` дольше TTL), либо рестарт API потерял состояние идущей дуэли, которое
живёт в памяти процесса, — строка осталась `active`, а таймеры её больше не
тронут.
"""

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.models.duel import DuelRoom
from app.models.duel_participant import DuelParticipant
from app.services.duel import now_utc


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code in (201, 400), r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _age_room(maker: async_sessionmaker[AsyncSession], room_id: uuid.UUID, days: int) -> None:
    """Состарить комнату на месте — иначе тест ждал бы сутки."""
    async with maker() as s:
        room = await s.get(DuelRoom, uuid.UUID(str(room_id)))
        assert room is not None
        room.created_at = now_utc() - timedelta(days=days)
        s.add(room)
        await s.commit()


async def _participant_rows(
    maker: async_sessionmaker[AsyncSession], room_id: uuid.UUID
) -> list[bool]:
    async with maker() as s:
        rows = (
            await s.execute(
                select(DuelParticipant.active).where(
                    DuelParticipant.room_id == uuid.UUID(str(room_id))
                )
            )
        ).all()
    return [r[0] for r in rows]


async def test_a_stale_invite_no_longer_blocks_a_new_room(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession], email_spy: object
) -> None:
    """Никто не открыл ссылку. Раньше это запирало создателя навсегда."""
    await _register_and_login(client, "stale@example.com")
    first = await client.post("/duel/rooms")
    assert first.status_code == 201, first.text
    room_id = first.json()["room_id"]

    # Пока приглашение свежее — второй комнаты быть не должно (инвариант цел).
    conflict = await client.post("/duel/rooms")
    assert conflict.status_code == 409

    await _age_room(session_maker, room_id, days=2)  # TTL приглашения — сутки

    again = await client.post("/duel/rooms")
    assert again.status_code == 201, again.text
    assert again.json()["room_id"] != room_id

    # Старая отпущена и помечена брошенной, а не висит «идущей».
    assert _participant_rows and all(
        a is False for a in await _participant_rows(session_maker, room_id)
    )
    async with session_maker() as s:
        old = await s.get(DuelRoom, uuid.UUID(room_id))
        assert old is not None and old.status == "abandoned"


async def test_leaving_a_room_frees_the_slot_immediately(
    client: AsyncClient, email_spy: object
) -> None:
    """Ждать час, нажав не ту кнопку, — плохая цена. Выход должен быть сразу."""
    await _register_and_login(client, "leaver@example.com")
    room_id = (await client.post("/duel/rooms")).json()["room_id"]

    left = await client.delete(f"/duel/rooms/{room_id}")
    assert left.status_code == 204, left.text

    again = await client.post("/duel/rooms")
    assert again.status_code == 201, again.text


async def test_leaving_is_idempotent(client: AsyncClient, email_spy: object) -> None:
    """Второе нажатие не должно давать ошибку: снаружи это то же «меня там нет»."""
    await _register_and_login(client, "twice@example.com")
    room_id = (await client.post("/duel/rooms")).json()["room_id"]
    assert (await client.delete(f"/duel/rooms/{room_id}")).status_code == 204
    assert (await client.delete(f"/duel/rooms/{room_id}")).status_code == 204


async def test_a_stranger_cannot_close_someone_elses_room(
    client: AsyncClient, email_spy: object
) -> None:
    """Чужая комната неотличима от несуществующей — 404, а не 403."""
    await _register_and_login(client, "owner@example.com")
    room_id = (await client.post("/duel/rooms")).json()["room_id"]

    client.cookies.clear()
    await _register_and_login(client, "stranger@example.com")
    assert (await client.delete(f"/duel/rooms/{room_id}")).status_code == 404

    # И комната осталась жива: чужой уход её не трогает.
    client.cookies.clear()
    await _register_and_login(client, "owner@example.com")
    assert (await client.get(f"/duel/rooms/{room_id}")).status_code == 200


async def test_anonymous_cannot_close_a_room(client: AsyncClient) -> None:
    assert (await client.delete(f"/duel/rooms/{uuid.uuid4()}")).status_code == 401


@pytest.mark.parametrize("days", [1, 30])
async def test_an_old_unfinished_room_releases_both_players(
    client: AsyncClient,
    session_maker: async_sessionmaker[AsyncSession],
    email_spy: object,
    days: int,
) -> None:
    """Рестарт API теряет состояние дуэли; строка в базе остаётся `active`.

    Заперты оказываются ОБА — и тот, кто создал, и тот, кто присоединился.
    """
    await _register_and_login(client, f"a{days}@example.com")
    created = (await client.post("/duel/rooms")).json()
    room_id, token = created["room_id"], created["invite_token"]

    client.cookies.clear()
    await _register_and_login(client, f"b{days}@example.com")
    assert (await client.post(f"/duel/join/{token}")).status_code == 200

    await _age_room(session_maker, room_id, days=days)

    # Второй игрок больше не заперт.
    assert (await client.post("/duel/rooms")).status_code == 201
