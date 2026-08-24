"""`/email/prefs` (cookie-authed toggle) + `/email/unsubscribe` (no-auth,
token-authed) — Этап B of the friend-chat plan.
"""

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import EmailPrefs, User
from app.services.unsubscribe_token import sign

PASSWORD = "sup3r-secret-pw"
SECRET = "r3Bq7Ht2Ux-unit-unsubscribe-sign-key-0123456789abcdef"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert r.status_code == 204, r.text


async def _user_id(session_maker: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with session_maker() as session:
        result = await session.execute(select(User.id).where(User.email == email))
        return result.scalar_one()


# --------------------------------------------------------------------------- #
# GET/PUT /email/prefs
# --------------------------------------------------------------------------- #


async def test_default_is_enabled_with_no_row(client: AsyncClient) -> None:
    await _register_and_login(client, "alice@example.com")
    resp = await client.get("/email/prefs")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"chat_email_enabled": True}


async def test_put_disables_then_get_reflects_it(client: AsyncClient) -> None:
    await _register_and_login(client, "bob@example.com")
    resp = await client.put("/email/prefs", json={"chat_email_enabled": False})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"chat_email_enabled": False}

    resp = await client.get("/email/prefs")
    assert resp.json() == {"chat_email_enabled": False}


async def test_prefs_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/email/prefs")
    assert resp.status_code == 401
    resp = await client.put("/email/prefs", json={"chat_email_enabled": False})
    assert resp.status_code == 401


async def test_put_extra_field_rejected(client: AsyncClient) -> None:
    await _register_and_login(client, "carol@example.com")
    resp = await client.put(
        "/email/prefs", json={"chat_email_enabled": False, "unsubscribed_at": "2020-01-01"}
    )
    assert resp.status_code == 422


# --------------------------------------------------------------------------- #
# POST /email/unsubscribe
# --------------------------------------------------------------------------- #


async def test_unsubscribe_via_query_token_no_auth(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "dave@example.com")
    user_id = await _user_id(session_maker, "dave@example.com")
    client.cookies.clear()  # prove no auth is needed

    token = sign(user_id, 1, SECRET)
    resp = await client.post(f"/email/unsubscribe?token={token}")
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith("text/plain")
    # RFC 8058: MUST NOT redirect.
    assert "location" not in resp.headers

    async with session_maker() as session:
        prefs = await session.get(EmailPrefs, user_id)
        assert prefs is not None
        assert prefs.chat_email_enabled is False
        assert prefs.unsubscribed_at is not None


async def test_unsubscribe_via_json_body_token(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "erin@example.com")
    user_id = await _user_id(session_maker, "erin@example.com")
    client.cookies.clear()

    token = sign(user_id, 1, SECRET)
    resp = await client.post("/email/unsubscribe", json={"token": token})
    assert resp.status_code == 200, resp.text

    async with session_maker() as session:
        prefs = await session.get(EmailPrefs, user_id)
        assert prefs is not None
        assert prefs.chat_email_enabled is False


async def test_forged_token_rejected(client: AsyncClient) -> None:
    resp = await client.post("/email/unsubscribe?token=not-a-real-token")
    assert resp.status_code == 400


async def test_missing_token_rejected(client: AsyncClient) -> None:
    resp = await client.post("/email/unsubscribe")
    assert resp.status_code == 400


async def test_stale_token_after_resubscribe_rejected(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Plan §8: "после подписки обратно (token_version + 1) старая ссылка
    -> 400"."""
    await _register_and_login(client, "frank@example.com")
    user_id = await _user_id(session_maker, "frank@example.com")

    old_token = sign(user_id, 1, SECRET)

    # Unsubscribe once (bumps token_version 1 -> 2).
    resp = await client.post(f"/email/unsubscribe?token={old_token}")
    assert resp.status_code == 200, resp.text

    # Re-subscribe via the authed toggle (bumps token_version 2 -> 3).
    resp = await client.put("/email/prefs", json={"chat_email_enabled": True})
    assert resp.status_code == 200, resp.text

    # The OLD link (version 1) must now be dead.
    client.cookies.clear()
    resp = await client.post(f"/email/unsubscribe?token={old_token}")
    assert resp.status_code == 400


async def test_second_click_of_the_same_already_used_link_is_400(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """An unsubscribe link is single-use: the FIRST POST bumps
    `token_version` (plan §7B, "unsubscribing... bumps token_version"), so
    replaying the identical link a second time is indistinguishable from a
    stale/forged one — same 400, not a silent no-op. A person who wants to
    re-subscribe uses the profile toggle (`PUT /email/prefs`), which mints
    a fresh version/link relationship going forward.
    """
    await _register_and_login(client, "gina@example.com")
    user_id = await _user_id(session_maker, "gina@example.com")
    client.cookies.clear()

    token = sign(user_id, 1, SECRET)
    first = await client.post(f"/email/unsubscribe?token={token}")
    assert first.status_code == 200, first.text
    second = await client.post(f"/email/unsubscribe?token={token}")
    assert second.status_code == 400
