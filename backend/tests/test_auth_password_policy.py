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


# --- the fix: only FAILED attempts spend budget ------------------------------
#
# Every request below uses its own fake source IP (`_client_from_ip`), same
# trick as the cross-IP test above — AUTH_RATE_LIMIT is ALSO 10/minute, keyed
# by IP, and would otherwise trip first and make these tests meaningless.


async def test_login_account_rate_limit_ten_successful_logins_never_429(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """The reported bug: a person who correctly enters their password many
    times in a row (retries, a second tab, ...) must never see 429 — only
    wrong guesses may spend the account's budget."""
    email = "good-typist@example.com"
    await _register(client, email)

    for i in range(10):
        async with _client_from_ip(f"10.4.0.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": STRONG_PASSWORD}
            )
            assert resp.status_code == 204, (i, resp.text)


async def test_login_account_rate_limit_ten_failures_429_on_eleventh(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    email = "bad-guesser@example.com"
    await _register(client, email)

    statuses: list[int] = []
    for i in range(11):
        async with _client_from_ip(f"10.5.0.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)

    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


async def test_logout_spends_no_account_budget(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Logout never touches the account bucket at all (it no-ops off any
    path that isn't `/login`) — repeated logouts must not eat into the
    budget a subsequent login attempt run would need."""
    email = "logs-out-a-lot@example.com"
    await _register(client, email)

    async with _client_from_ip("10.7.0.1") as c:
        resp = await c.post("/auth/login", data={"username": email, "password": STRONG_PASSWORD})
        assert resp.status_code == 204, resp.text
        for _ in range(5):
            # First logout invalidates the session (204); repeats then have
            # no valid cookie left (401) — either way, no 429 and no spend.
            resp = await c.post("/auth/logout")
            assert resp.status_code in (204, 401), resp.text

    # Full 10-failure budget still available afterwards.
    statuses: list[int] = []
    for i in range(11):
        async with _client_from_ip(f"10.7.1.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)
    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


async def test_login_account_rate_limit_success_resets_the_counter(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """A correct login after a run of failures proves the account isn't
    under attack — the budget must come back in full, not stay drained."""
    email = "recovers@example.com"
    await _register(client, email)

    for i in range(5):
        async with _client_from_ip(f"10.6.0.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            assert resp.status_code != 429, (i, resp.text)

    async with _client_from_ip("10.6.0.100") as c:
        resp = await c.post("/auth/login", data={"username": email, "password": STRONG_PASSWORD})
        assert resp.status_code == 204, resp.text

    # Full budget again: 10 more failures must not trip until the 11th.
    statuses: list[int] = []
    for i in range(11):
        async with _client_from_ip(f"10.6.1.{i + 1}") as c:
            resp = await c.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)
    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


# --- per-IP login rate limit: same fix, one layer up (rule 6) ---------------
#
# AUTH_RATE_LIMIT (ip_rate_limit) sits ABOVE the per-account limit and is
# keyed by source IP, not account. It had the exact same bug: unconditional
# `hit()` on every /auth/login request, successful ones included. These
# tests all reuse the `client` fixture directly (no `_client_from_ip`) so
# every request comes from the SAME source IP — that's the point.


async def test_login_ip_rate_limit_eleven_successful_logins_same_ip_never_429(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """The reported bug, one layer up: logging in correctly many times in a
    row from ONE IP (retries, several tabs, a shared office connection) must
    never 429 — only wrong guesses from that IP should spend its budget.
    11 requests (not 10) because AUTH_RATE_LIMIT=10/minute only trips on the
    11th hit — on the old unconditional-hit code this is exactly where it
    would have failed."""
    email = "same-ip-good-typist@example.com"
    await _register(client, email)

    for i in range(11):
        resp = await client.post(
            "/auth/login", data={"username": email, "password": STRONG_PASSWORD}
        )
        assert resp.status_code == 204, (i, resp.text)


async def test_login_ip_rate_limit_ten_failures_across_accounts_429_on_eleventh(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Brute-forcing many DIFFERENT accounts from one IP must still trip the
    IP limit — that's the whole point of having an IP layer above the
    per-account one. Each account only sees ONE failed attempt here, well
    under its own 10/minute budget, so only the IP bucket can explain the
    429.

    Setup (registering the 11 victim accounts) uses `_client_from_ip` with a
    fresh IP per call so it doesn't itself trip AUTH_RATE_LIMIT on
    `/auth/register` — only the login loop below, all from ONE fixed IP,
    is under test."""
    emails = [f"ip-victim-{i}@example.com" for i in range(11)]
    for i, email in enumerate(emails):
        async with _client_from_ip(f"10.8.0.{i + 1}") as c:
            await _register(c, email)

    statuses: list[int] = []
    async with _client_from_ip("10.9.0.1") as attacker:
        for email in emails:
            resp = await attacker.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)

    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


async def test_login_ip_rate_limit_success_resets_the_ip_counter(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """A successful login from an IP proves that IP isn't (right now) being
    used to brute-force accounts — its budget must come back in full, same
    as the per-account counter does."""
    victim_emails = [f"ip-recovers-victim-{i}@example.com" for i in range(5)]
    good_email = "ip-recovers-good@example.com"
    more_victims = [f"ip-recovers-victim2-{i}@example.com" for i in range(11)]
    all_emails = [*victim_emails, good_email, *more_victims]
    for i, email in enumerate(all_emails):
        async with _client_from_ip(f"10.10.0.{i + 1}") as c:
            await _register(c, email)

    async with _client_from_ip("10.11.0.1") as attacker:
        # 5 failures against 5 DIFFERENT accounts (so no per-account limit
        # fires) from the same IP.
        for email in victim_emails:
            resp = await attacker.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            assert resp.status_code != 429, resp.text

        resp = await attacker.post(
            "/auth/login", data={"username": good_email, "password": STRONG_PASSWORD}
        )
        assert resp.status_code == 204, resp.text

        # Full IP budget again: 10 more failures (against yet more distinct
        # accounts) must not trip until the 11th.
        statuses: list[int] = []
        for email in more_victims:
            resp = await attacker.post(
                "/auth/login", data={"username": email, "password": "wrong-password-here"}
            )
            statuses.append(resp.status_code)
    assert 429 not in statuses[:10], statuses
    assert statuses[10] == 429, statuses


async def test_register_ip_rate_limit_still_counts_successes(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """The fix is scoped to `/auth/login` only. `/auth/register` (and by the
    same code path verify/forgot/reset-password) must keep spending its IP
    budget on every request INCLUDING success — a successful register sends
    a verification email, which is precisely what's being throttled."""
    statuses: list[int] = []
    for i in range(11):
        resp = await client.post(
            "/auth/register",
            json={"email": f"reg-ip-limit-{i}@example.com", "password": STRONG_PASSWORD},
        )
        statuses.append(resp.status_code)

    assert statuses[:10] == [201] * 10, statuses
    assert statuses[10] == 429, statuses
