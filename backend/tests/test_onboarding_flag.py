"""Признак «онбординг пройден» живёт на сервере, а не в браузере.

Раньше он был ключом localStorage, то есть отвечал на вопрос «показывали ли в
ЭТОМ браузере», а не «проходил ли ЭТОТ человек». Поймано живьём 2026-08-20: при
первом входе через Google в браузере, где онбординг уже проходили другим
аккаунтом, новый пользователь молча уехал на главную. Обратный симптом не менее
неприятен: тот же человек со второго устройства получал онбординг заново.
"""

from httpx import AsyncClient


async def _register_and_login(client: AsyncClient, email: str) -> None:
    await client.post("/auth/register", json={"email": email, "password": "correct-horse-42"})
    resp = await client.post(
        "/auth/login", data={"username": email, "password": "correct-horse-42"}
    )
    assert resp.status_code == 204, resp.text


async def test_new_account_has_not_onboarded(client: AsyncClient, email_spy: object) -> None:
    await _register_and_login(client, "fresh@example.com")
    me = await client.get("/users/me")
    assert me.status_code == 200
    assert me.json()["onboarded_at"] is None


async def test_marking_sets_the_timestamp(client: AsyncClient, email_spy: object) -> None:
    await _register_and_login(client, "walks@example.com")

    resp = await client.post("/users/me/onboarded")
    assert resp.status_code == 200, resp.text
    stamped = resp.json()["onboarded_at"]
    assert stamped is not None

    # И оно действительно сохранилось, а не вернулось только в ответе.
    me = await client.get("/users/me")
    assert me.json()["onboarded_at"] == stamped


async def test_marking_twice_keeps_the_first_time(client: AsyncClient, email_spy: object) -> None:
    """Идемпотентность: повторный вызов не двигает дату.

    Фронт зовёт ручку свободно — в том числе при переносе старого локального
    флага, — и не должен каждым заходом переписывать единственное, что эта дата
    означает: когда человек прошёл онбординг ВПЕРВЫЕ.
    """
    await _register_and_login(client, "twice@example.com")

    first = (await client.post("/users/me/onboarded")).json()["onboarded_at"]
    second = (await client.post("/users/me/onboarded")).json()["onboarded_at"]
    assert first == second


async def test_anonymous_cannot_mark(client: AsyncClient) -> None:
    resp = await client.post("/users/me/onboarded")
    assert resp.status_code == 401


async def test_one_account_does_not_mark_another(client: AsyncClient, email_spy: object) -> None:
    """Отметка привязана к сессии, а не к браузеру — ровно то, ради чего всё это."""
    await _register_and_login(client, "first@example.com")
    await client.post("/users/me/onboarded")
    await client.post("/auth/logout")

    await _register_and_login(client, "second@example.com")
    me = await client.get("/users/me")
    assert me.json()["onboarded_at"] is None
