"""Витрина профиля (V3): метод сборки и год начала.

Оба поля владелец-only — публичных профилей в Cubr нет; борды по-прежнему несут
только `handle` (П10). Здесь проверяются валидация и то, что витрина
никуда не утекает.
"""

from datetime import datetime, timezone

from httpx import AsyncClient

from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def test_defaults_are_empty(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "showcase-empty@example.com")
    body = (await client.get("/users/me")).json()
    assert body["method"] is None
    assert body["cubing_since_year"] is None


async def test_saves_method_and_year(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "showcase@example.com")

    resp = await client.patch("/users/me", json={"method": "roux", "cubing_since_year": 2019})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["method"] == "roux"
    assert body["cubing_since_year"] == 2019

    assert (await client.get("/users/me")).json()["method"] == "roux"


async def test_unknown_method_rejected(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "showcase-bad@example.com")
    resp = await client.patch("/users/me", json={"method": "cfop-но-по-своему"})
    assert resp.status_code == 422, resp.text


async def test_year_bounds(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "showcase-year@example.com")
    next_year = datetime.now(timezone.utc).year + 1

    assert (await client.patch("/users/me", json={"cubing_since_year": 1900})).status_code == 422
    assert (
        await client.patch("/users/me", json={"cubing_since_year": next_year})
    ).status_code == 422
    assert (await client.patch("/users/me", json={"cubing_since_year": 1974})).status_code == 200


async def test_showcase_never_reaches_the_boards(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "showcase-board@example.com")
    await client.patch(
        "/users/me",
        json={"method": "cfop", "cubing_since_year": 2020, "handle": "SpeedCuber"},
    )
    await client.post("/tournament/current/attempt/start")
    await client.post("/tournament/current/attempt/submit", json={"time_ms": 12345})

    raw = (await client.get("/tournament/current/standings")).text
    assert "cfop" not in raw
    assert "2020" not in raw
    assert "SpeedCuber" in raw  # сам хендл — да, он для этого и заведён
