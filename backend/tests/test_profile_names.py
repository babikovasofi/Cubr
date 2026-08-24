"""Name filter at the API edge (Stage 6): registration handle, PATCH
/users/me (handle), and the OAuth-derived handle.

The error shape matters as much as the rejection: the SPA understands
`detail: {code, reason}` and would show a generic "что-то пошло не так" for a
pydantic 422 array.
"""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.services.auth import _derive_handle
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def test_register_with_obscene_handle_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "rude@example.com", "password": PASSWORD, "handle": "пиздец"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_NOT_ALLOWED"


async def test_rejected_registration_creates_no_user(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await client.post(
        "/auth/register",
        json={"email": "rude2@example.com", "password": PASSWORD, "handle": "fuck"},
    )
    async with session_maker() as session:
        found = (
            (await session.execute(select(User).where(User.email == "rude2@example.com")))
            .unique()
            .scalar_one_or_none()
        )
    assert found is None
    assert email_spy.verifications == []


async def test_register_with_clean_handle_201(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "ok@example.com", "password": PASSWORD, "handle": "Феликс"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["handle"] == "Феликс"


async def test_patch_handle_obscene_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "handle@example.com")

    resp = await client.patch("/users/me", json={"handle": "СУКА blyat"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_NOT_ALLOWED"

    # И поле не изменилось.
    me = await client.get("/users/me")
    assert me.json()["handle"] is None


async def test_patch_handle_reserved_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "reserved@example.com")

    resp = await client.patch("/users/me", json={"handle": "Администратор"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_RESERVED"


async def test_patch_handle_emoji_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "emoji@example.com")

    resp = await client.patch("/users/me", json={"handle": "куб🔥"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_INVALID_CHARS"


async def test_patch_clean_handle_ok(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "clean@example.com")

    resp = await client.patch("/users/me", json={"handle": "Cube-Master_99"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["handle"] == "Cube-Master_99"


async def test_clearing_handle_still_allowed(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "clear@example.com")
    await client.patch("/users/me", json={"handle": "SpeedCuber"})

    # Пустая строка нормализуется в None — очистка не должна упираться в фильтр.
    resp = await client.patch("/users/me", json={"handle": "   "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["handle"] is None


async def test_handle_unique_case_insensitive(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "handle-owner@example.com")
    resp = await client.patch("/users/me", json={"handle": "SpeedCuber"})
    assert resp.status_code == 200, resp.text

    # A second account, logging in fresh, tries a same-case-insensitive handle.
    await client.post("/auth/logout")
    await _register_and_login(client, "handle-taker@example.com")
    resp = await client.patch("/users/me", json={"handle": "speedcuber"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "HANDLE_TAKEN"

    # Not a 500, and the handle in the DB is untouched.
    me = await client.get("/users/me")
    assert me.json()["handle"] is None


async def test_register_handle_unique_case_insensitive(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Registration is now also a write path for `handle` — same collision
    guard as PATCH, not a raw 500 (see `UserManager.create`)."""
    resp = await client.post(
        "/auth/register",
        json={"email": "reg-owner@example.com", "password": PASSWORD, "handle": "RegHandle"},
    )
    assert resp.status_code == 201, resp.text

    resp = await client.post(
        "/auth/register",
        json={"email": "reg-taker@example.com", "password": PASSWORD, "handle": "reghandle"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "HANDLE_TAKEN"


def test_oauth_derived_handle_is_sanitised() -> None:
    # Ронять OAuth-редирект 400-кой из-за локалпарта почты нельзя — только fallback.
    assert _derive_handle("pizdec@example.com") == "cuber"
    assert _derive_handle("admin@example.com") == "cuber"
    assert _derive_handle("feliks@example.com") == "feliks"
