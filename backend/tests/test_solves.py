from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from httpx import AsyncClient

from app.models import Solve, User
from tests.conftest import EmailSpy

COOKIE = "cubr_auth"

VALID_SCRAMBLE = "R U R' U'"

CUBE_PROFILE: dict[str, list[float]] = {
    "U": [95.0, 0.0, 0.0],
    "R": [50.0, 60.0, 40.0],
    "F": [45.0, -50.0, 45.0],
    "D": [90.0, -5.0, 80.0],
    "L": [55.0, 55.0, -30.0],
    "B": [40.0, 20.0, -55.0],
}


async def _create_cube(client: AsyncClient, name: str = "primary") -> str:
    resp = await client.post("/cubes", json={"name": name, "color_profile": CUBE_PROFILE})
    assert resp.status_code == 201, resp.text
    cube_id: str = resp.json()["id"]
    return cube_id


async def _register(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text


async def _login(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 204, resp.text
    assert COOKIE in resp.cookies


async def _register_and_login(client: AsyncClient, email_spy: EmailSpy, email: str) -> None:
    await _register(client, email)
    await _login(client, email)


# --- auth gate --------------------------------------------------------------


async def test_post_solves_anonymous_401(client: AsyncClient) -> None:
    resp = await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 5000})
    assert resp.status_code == 401, resp.text


async def test_get_solves_anonymous_401(client: AsyncClient) -> None:
    resp = await client.get("/solves")
    assert resp.status_code == 401, resp.text


# --- create + persist -------------------------------------------------------


async def test_post_solve_201_and_persisted(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "solver@example.com")
    resp = await client.post(
        "/solves",
        json={
            "scramble": VALID_SCRAMBLE,
            "time_ms": 4200,
            "status": "valid",
            "verify_frames_ok": True,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["scramble"] == VALID_SCRAMBLE
    assert body["time_ms"] == 4200
    assert body["status"] == "valid"
    assert body["verify_frames_ok"] is True
    assert "id" in body and "created_at" in body

    async with session_maker() as session:
        rows = (await session.execute(select(Solve))).scalars().all()
    assert len(rows) == 1
    assert rows[0].time_ms == 4200


# --- ownership isolation ----------------------------------------------------


async def test_get_solves_returns_only_own(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "alice@example.com")
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 3000})
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 3500})

    # Second user: logging in overwrites the auth cookie.
    await _register_and_login(client, email_spy, "bob@example.com")
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 9000})

    resp = await client.get("/solves")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["time_ms"] == 9000

    # Back to Alice: she sees only her two (and none of Bob's). Order between
    # the two is not asserted — they share a created_at on sqlite.
    await _login(client, "alice@example.com")
    resp = await client.get("/solves")
    assert resp.status_code == 200, resp.text
    times = sorted(s["time_ms"] for s in resp.json())
    assert times == [3000, 3500]


# --- best_single_ms ---------------------------------------------------------


async def _best_single(session_maker: async_sessionmaker[AsyncSession], email: str) -> int | None:
    async with session_maker() as session:
        user = (
            (await session.execute(select(User).where(User.email == email))).unique().scalar_one()
        )
    return user.best_single_ms


async def test_best_single_ms_updates_only_on_faster_valid(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    email = "pb@example.com"
    await _register_and_login(client, email_spy, email)

    # First valid solve sets the PB.
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 5000})
    assert await _best_single(session_maker, email) == 5000

    # Slower valid solve does not change it.
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 6000})
    assert await _best_single(session_maker, email) == 5000

    # A faster DNF must NOT update the PB.
    await client.post(
        "/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 1000, "status": "dnf"}
    )
    assert await _best_single(session_maker, email) == 5000

    # Faster valid solve updates it.
    await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 3000})
    assert await _best_single(session_maker, email) == 3000


# --- schema validation ------------------------------------------------------


async def test_status_rejected_is_refused_by_schema(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, email_spy, "cheater@example.com")
    resp = await client.post(
        "/solves",
        json={"scramble": VALID_SCRAMBLE, "time_ms": 5000, "status": "rejected"},
    )
    assert resp.status_code == 422, resp.text


async def test_invalid_time_ms_is_refused_by_schema(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, email_spy, "zerotime@example.com")
    resp = await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 0})
    assert resp.status_code == 422, resp.text


# --- cube_id ----------------------------------------------------------------


async def test_solve_with_own_cube_id_persists(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "withcube@example.com")
    cube_id = await _create_cube(client)
    resp = await client.post(
        "/solves",
        json={"scramble": VALID_SCRAMBLE, "time_ms": 4200, "cube_id": cube_id},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["cube_id"] == cube_id

    listed = (await client.get("/solves")).json()
    assert [s["cube_id"] for s in listed] == [cube_id]


async def test_solve_without_cube_id_is_null(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "nocube@example.com")
    resp = await client.post("/solves", json={"scramble": VALID_SCRAMBLE, "time_ms": 4200})
    assert resp.status_code == 201, resp.text
    assert resp.json()["cube_id"] is None


async def test_solve_with_unknown_cube_id_is_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "unknowncube@example.com")
    missing = "00000000-0000-0000-0000-000000000000"
    resp = await client.post(
        "/solves",
        json={"scramble": VALID_SCRAMBLE, "time_ms": 4200, "cube_id": missing},
    )
    assert resp.status_code == 404, resp.text


async def test_solve_with_foreign_cube_id_is_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "cubeowner@example.com")
    foreign_cube_id = await _create_cube(client)

    await _register_and_login(client, email_spy, "cubethief@example.com")
    resp = await client.post(
        "/solves",
        json={"scramble": VALID_SCRAMBLE, "time_ms": 4200, "cube_id": foreign_cube_id},
    )
    assert resp.status_code == 404, resp.text


async def test_deleting_cube_nulls_referencing_solve(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "deletecube@example.com")
    cube_id = await _create_cube(client)
    await client.post(
        "/solves",
        json={"scramble": VALID_SCRAMBLE, "time_ms": 4200, "cube_id": cube_id},
    )

    resp = await client.delete(f"/cubes/{cube_id}")
    assert resp.status_code == 204, resp.text

    # The solve survives; its cube_id was set to NULL (FK ON DELETE SET NULL).
    listed = (await client.get("/solves")).json()
    assert len(listed) == 1
    assert listed[0]["cube_id"] is None

    async with session_maker() as session:
        rows = (await session.execute(select(Solve))).scalars().all()
    assert len(rows) == 1
    assert rows[0].cube_id is None
