"""Name filter at the API edge (Stage 6): registration nickname, PATCH
/users/me (nickname + public_handle), and the OAuth-derived nickname.

The error shape matters as much as the rejection: the SPA understands
`detail: {code, reason}` and would show a generic "что-то пошло не так" for a
pydantic 422 array.
"""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.services.auth import _derive_nickname
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


async def test_register_with_obscene_nickname_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "rude@example.com", "password": PASSWORD, "nickname": "пиздец"},
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
        json={"email": "rude2@example.com", "password": PASSWORD, "nickname": "fuck"},
    )
    async with session_maker() as session:
        found = (
            (await session.execute(select(User).where(User.email == "rude2@example.com")))
            .unique()
            .scalar_one_or_none()
        )
    assert found is None
    assert email_spy.verifications == []


async def test_register_with_clean_nickname_201(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "ok@example.com", "password": PASSWORD, "nickname": "Феликс"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["nickname"] == "Феликс"


async def test_patch_public_handle_obscene_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "handle@example.com")

    resp = await client.patch("/users/me", json={"public_handle": "СУКА blyat"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_NOT_ALLOWED"

    # И поле не изменилось.
    me = await client.get("/users/me")
    assert me.json()["public_handle"] is None


async def test_patch_public_handle_reserved_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "reserved@example.com")

    resp = await client.patch("/users/me", json={"public_handle": "Администратор"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_RESERVED"


async def test_patch_public_handle_emoji_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "emoji@example.com")

    resp = await client.patch("/users/me", json={"public_handle": "куб🔥"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_INVALID_CHARS"


async def test_patch_nickname_filtered_too(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "nick@example.com")

    resp = await client.patch("/users/me", json={"nickname": "мудак"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_NOT_ALLOWED"


async def test_patch_clean_names_ok(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "clean@example.com")

    resp = await client.patch(
        "/users/me", json={"nickname": "Скипидар", "public_handle": "Cube-Master_99"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nickname"] == "Скипидар"
    assert body["public_handle"] == "Cube-Master_99"


async def test_clearing_public_handle_still_allowed(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "clear@example.com")
    await client.patch("/users/me", json={"public_handle": "SpeedCuber"})

    # Пустая строка нормализуется в None — очистка не должна упираться в фильтр.
    resp = await client.patch("/users/me", json={"public_handle": "   "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["public_handle"] is None


def test_oauth_derived_nickname_is_sanitised() -> None:
    # Ронять OAuth-редирект 400-кой из-за локалпарта почты нельзя — только fallback.
    assert _derive_nickname("pizdec@example.com") == "cuber"
    assert _derive_nickname("admin@example.com") == "cuber"
    assert _derive_nickname("feliks@example.com") == "feliks"
