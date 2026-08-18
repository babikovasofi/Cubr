"""Integration coverage for the server-side password policy: registration,
password reset, PATCH /users/me, the per-account login rate limit, and the
"old weak passwords still log in" compatibility guarantee.

Unit coverage of the rule logic itself lives in `tests/test_password_policy.py`.
"""

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import app
from app.models import User
from app.services.auth import password_helper
from tests.conftest import EmailSpy

STRONG_PASSWORD = "correct-horse-battery-staple"


async def _register(client: AsyncClient, email: str, password: str = STRONG_PASSWORD) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text


# --- registration: policy replaces the old "accept anything" behaviour -----


async def test_register_rejects_trivially_weak_passwords(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    # The exact repro from the bug report: '1', '123', 'password' used to
    # come back 201.
    for weak in ("1", "123", "password"):
        resp = await client.post(
            "/auth/register", json={"email": "weak@example.com", "password": weak}
        )
        assert resp.status_code == 400, (weak, resp.text)
        body = resp.json()
        # fastapi-users' stock InvalidPasswordException handling: a clean
        # {code, reason} 400, never a bare 422 detail[] array.
        assert body["detail"]["code"] == "REGISTER_INVALID_PASSWORD"
        assert body["detail"]["reason"]  # non-empty, human-readable Russian text


async def test_register_rejects_password_matching_email(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "identical@example.com", "password": "identical@example.com"},
    )
    assert resp.status_code == 400, resp.text
    assert "почт" in resp.json()["detail"]["reason"].lower()


async def test_register_rejects_password_matching_nickname(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    resp = await client.post(
        "/auth/register",
        json={
            "email": "nicky@example.com",
            "password": "SpeedCuber99",
            "nickname": "speedcuber99",
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "REGISTER_INVALID_PASSWORD"


async def test_register_accepts_strong_password(client: AsyncClient, email_spy: EmailSpy) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "strong@example.com", "password": STRONG_PASSWORD},
    )
    assert resp.status_code == 201, resp.text


# --- password reset goes through the SAME checks as registration -----------


async def test_reset_password_enforces_policy(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register(client, "reset-weak@example.com")
    resp = await client.post("/auth/forgot-password", json={"email": "reset-weak@example.com"})
    assert resp.status_code == 202, resp.text
    _, token = email_spy.resets[0]

    # "Forgot password" must not be a backdoor around the policy.
    resp = await client.post("/auth/reset-password", json={"token": token, "password": "123"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "RESET_PASSWORD_INVALID_PASSWORD"
    assert resp.json()["detail"]["reason"]

    # A policy-compliant new password still works.
    resp = await client.post(
        "/auth/reset-password",
        json={"token": token, "password": "another-strong-pw-99"},
    )
    assert resp.status_code == 200, resp.text

    resp = await client.post(
        "/auth/login",
        data={"username": "reset-weak@example.com", "password": "another-strong-pw-99"},
    )
    assert resp.status_code == 204, resp.text


async def test_patch_me_password_change_enforces_policy(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    email = "patchme@example.com"
    await _register(client, email)
    login = await client.post("/auth/login", data={"username": email, "password": STRONG_PASSWORD})
    assert login.status_code == 204, login.text

    resp = await client.patch("/users/me", json={"password": "123"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "UPDATE_USER_INVALID_PASSWORD"
    assert resp.json()["detail"]["reason"]


# --- existing (pre-policy) weak passwords keep logging in -------------------


async def test_preexisting_weak_password_can_still_login(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    # Simulate an account created BEFORE this policy existed: insert the row
    # directly (bypassing UserManager.create / validate_password), the same
    # way the app itself hashes passwords.
    async with session_maker() as session:
        user = User(
            email="legacy@example.com",
            hashed_password=password_helper.hash("123"),
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        await session.commit()

    resp = await client.post(
        "/auth/login", data={"username": "legacy@example.com", "password": "123"}
    )
    assert resp.status_code == 204, resp.text


# --- per-account login rate limit (rule 5) ----------------------------------


def _client_from_ip(ip: str) -> AsyncClient:
    """A fresh AsyncClient hitting the same `app` from a distinct fake
    source IP — `app.dependency_overrides` set by the `client` fixture
    already applies (same `app` object), so no separate DB wiring needed."""
    transport = ASGITransport(app=app, client=(ip, 1))
    return AsyncClient(transport=transport, base_url="http://test")


async def test_login_account_rate_limit_trips_across_different_ips(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    email = "victim@example.com"
    await _register(client, email)

    statuses: list[int] = []
    for i in range(11):
        async with _client_from_ip(f"10.1.0.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)

    # LOGIN_ACCOUNT_RATE_LIMIT=10/minute: the first 10 (each from a brand new
    # IP, so AUTH_RATE_LIMIT's per-IP window never fires) must NOT be
    # account-limited; the 11th must be.
    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


async def test_login_account_rate_limit_is_per_account_not_per_ip(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    victim = "victim2@example.com"
    other = "bystander@example.com"
    await _register(client, victim)
    await _register(client, other)

    # Exhaust the account limit for `victim`, each attempt from its own IP
    # (so the shared IP limiter never trips and can't explain a 429).
    for i in range(10):
        async with _client_from_ip(f"10.2.0.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": victim, "password": "wrong-password-here"}
            )
            assert resp.status_code != 429, (i, resp.text)

    # `other`, from a brand-new IP, is a different account: unaffected.
    async with _client_from_ip("10.2.0.99") as c:
        resp = await c.post("/auth/login", data={"username": other, "password": STRONG_PASSWORD})
        assert resp.status_code == 204, resp.text


async def test_login_account_rate_limit_does_not_apply_to_logout(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    email = "logout-guy@example.com"
    await _register(client, email)
    resp = await client.post("/auth/login", data={"username": email, "password": STRONG_PASSWORD})
    assert resp.status_code == 204, resp.text

    # Several logouts in a row from the same client must not be limited by
    # the account bucket (it only ever applies to /auth/login).
    for _ in range(3):
        resp = await client.post("/auth/logout")
        assert resp.status_code in (204, 401), resp.text
