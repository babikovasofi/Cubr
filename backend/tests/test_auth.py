from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from httpx import AsyncClient

from app.models import User
from tests.conftest import EmailSpy

COOKIE = "cubr_auth"


async def _register(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text


async def _login(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 204, resp.text
    assert COOKIE in resp.cookies


# --- register ---------------------------------------------------------------


async def test_register_hashes_argon2_and_unverified(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    resp = await client.post(
        "/auth/register", json={"email": "a@example.com", "password": "sup3r-secret-pw"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_verified"] is False
    assert "hashed_password" not in body  # never leak the hash

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == "a@example.com"))
        ).unique().scalar_one()
    assert user.hashed_password.startswith("$argon2")
    assert user.is_verified is False


async def test_register_duplicate_email_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register(client, "dup@example.com")
    resp = await client.post(
        "/auth/register", json={"email": "dup@example.com", "password": "another-pw-123"}
    )
    assert resp.status_code == 400, resp.text


async def test_register_sends_one_verification_email(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register(client, "verify-me@example.com")
    assert len(email_spy.verifications) == 1
    to, token = email_spy.verifications[0]
    assert to == "verify-me@example.com"
    assert token  # a real token was passed


# --- login / me / logout ----------------------------------------------------


async def test_login_sets_httponly_cookie_no_body_leak(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register(client, "login@example.com")
    resp = await client.post(
        "/auth/login", data={"username": "login@example.com", "password": "sup3r-secret-pw"}
    )
    assert resp.status_code == 204, resp.text
    set_cookie = resp.headers["set-cookie"]
    assert "httponly" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()
    # No bearer token leaked into the body.
    assert resp.content in (b"", b"null")


async def test_login_bad_credentials_400(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register(client, "badcreds@example.com")
    resp = await client.post(
        "/auth/login", data={"username": "badcreds@example.com", "password": "wrong-password"}
    )
    assert resp.status_code == 400, resp.text


async def test_users_me_requires_cookie(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.get("/users/me")
    assert resp.status_code == 401

    await _register(client, "me@example.com")
    await _login(client, "me@example.com")
    resp = await client.get("/users/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == "me@example.com"


async def test_logout_clears_cookie(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register(client, "logout@example.com")
    await _login(client, "logout@example.com")
    resp = await client.post("/auth/logout")
    assert resp.status_code == 204, resp.text
    # Cookie is present in the jar and cleared → /users/me is unauthorized again.
    client.cookies.delete(COOKIE)
    resp = await client.get("/users/me")
    assert resp.status_code == 401


async def test_unverified_user_can_login(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Policy (2.2): email verification does NOT gate login."""
    await _register(client, "unverified@example.com")
    resp = await client.post(
        "/auth/login",
        data={"username": "unverified@example.com", "password": "sup3r-secret-pw"},
    )
    assert resp.status_code == 204, resp.text


# --- verification flow ------------------------------------------------------


async def test_verify_flow_marks_verified(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register(client, "vf@example.com")
    _, token = email_spy.verifications[0]
    resp = await client.post("/auth/verify", json={"token": token})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_verified"] is True

    async with session_maker() as session:
        user = (
            await session.execute(select(User).where(User.email == "vf@example.com"))
        ).unique().scalar_one()
    assert user.is_verified is True


# --- password reset flow ----------------------------------------------------


async def test_reset_password_flow(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register(client, "reset@example.com", password="old-password-123")

    resp = await client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    assert resp.status_code == 202, resp.text
    assert len(email_spy.resets) == 1
    _, token = email_spy.resets[0]

    resp = await client.post(
        "/auth/reset-password", json={"token": token, "password": "new-password-456"}
    )
    assert resp.status_code == 200, resp.text

    # Old password rejected, new password works.
    resp = await client.post(
        "/auth/login", data={"username": "reset@example.com", "password": "old-password-123"}
    )
    assert resp.status_code == 400
    resp = await client.post(
        "/auth/login", data={"username": "reset@example.com", "password": "new-password-456"}
    )
    assert resp.status_code == 204, resp.text


# --- rate limiting ----------------------------------------------------------


async def test_login_ip_rate_limit_429(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register(client, "rl@example.com")
    # AUTH_RATE_LIMIT=10/minute. First attempt must not be limited.
    first = await client.post(
        "/auth/login", data={"username": "rl@example.com", "password": "wrong"}
    )
    assert first.status_code != 429
    statuses = [first.status_code]
    for _ in range(15):
        r = await client.post(
            "/auth/login", data={"username": "rl@example.com", "password": "wrong"}
        )
        statuses.append(r.status_code)
    assert 429 in statuses, statuses


async def test_register_email_rate_limit_429(client: AsyncClient, email_spy: EmailSpy) -> None:
    # EMAIL_RATE_LIMIT=3/hour keyed by target email; same email > 3 times → 429
    # (well under the 10/min IP limit).
    email = "flood@example.com"
    statuses = []
    for i in range(5):
        r = await client.post(
            "/auth/register", json={"email": email, "password": f"password-{i}-xyz"}
        )
        statuses.append(r.status_code)
    assert 429 in statuses, statuses


# --- oauth authorize --------------------------------------------------------


async def test_google_authorize_returns_google_url(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    resp = await client.get("/auth/google/authorize")
    assert resp.status_code == 200, resp.text
    url = resp.json()["authorization_url"]
    assert "accounts.google.com" in url
