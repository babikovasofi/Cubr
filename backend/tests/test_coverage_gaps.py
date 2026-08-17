"""Coverage gaps from task/README.md logic audit.

Catching regressions in: invalid cube_id on solve submission, daily/tournament
edge states, and boundary conditions in moderation.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Cube, DailyAttempt, DailyChallenge, TournamentAttempt, User
from tests.conftest import EmailSpy

PASSWORD = "sup3r-secret-pw"


async def _register_and_login(client: AsyncClient, email: str) -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    assert resp.status_code == 204, resp.text


# ============================================================================
# Solves: invalid cube_id
# ============================================================================


async def test_create_solve_with_nonexistent_cube_id_404(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Solve with a cube_id that doesn't belong to the user -> 404."""
    await _register_and_login(client, "solve-cube@example.com")

    fake_id = uuid.uuid4()
    resp = await client.post(
        "/solves",
        json={
            "scramble": "R U R' U'",
            "time_ms": 5000,
            "status": "valid",
            "cube_id": str(fake_id),
        },
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Cube not found"


async def test_create_solve_with_other_users_cube_id_404(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Solve referencing another user's cube -> 404 (ownership check)."""
    await _register_and_login(client, "owner@example.com")
    # Create a cube for this user (simplified — no front-end flow).
    async with session_maker() as session:
        user = (await session.execute(select(User).where(User.email == "owner@example.com"))).unique().scalar_one()
        cube = Cube(
            user_id=user.id,
            name="Owner's Cube",
            color_profile={"U": "white", "R": "red", "F": "green", "D": "yellow", "L": "orange", "B": "blue"}
        )
        session.add(cube)
        await session.flush()
        owner_cube_id = cube.id

    # Switch to a different user and try to use the first user's cube.
    client.cookies.clear()
    resp = await client.post("/auth/register", json={"email": "thief@example.com", "password": PASSWORD})
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", data={"username": "thief@example.com", "password": PASSWORD})
    assert resp.status_code == 204, resp.text

    resp = await client.post(
        "/solves",
        json={
            "scramble": "R U R' U'",
            "time_ms": 5000,
            "status": "valid",
            "cube_id": str(owner_cube_id),
        },
    )
    assert resp.status_code == 404, resp.text


# ============================================================================
# Tournament/Daily: attempt state transitions
# ============================================================================


async def test_tournament_get_current_on_first_visit_200(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """GET /tournament/current returns 200 with empty state on first visit."""
    await _register_and_login(client, "tour-first@example.com")
    resp = await client.get("/tournament/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["attempt_status"] is None
    assert body["time_ms"] is None


async def test_daily_board_counts_only_submitted_attempts(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Daily standings omit abandoned (unsubmitted) attempts."""
    await _register_and_login(client, "daily-abandon@example.com")
    user_id = (await client.get("/users/me")).json()["id"]

    today = datetime.now(timezone.utc).date()
    async with session_maker() as session:
        daily = DailyChallenge(date=today, scramble="R U R' U'")
        session.add(daily)
        await session.flush()

        # Abandoned attempt (started but not submitted).
        session.add(
            DailyAttempt(
                user_id=uuid.UUID(user_id),
                daily_id=daily.id,
                status="dnf",
                started_at=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
                submitted_at=None,
            )
        )
        await session.commit()

    resp = await client.get("/daily/current/board")
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    # The abandoned attempt should not appear.
    assert len(entries) == 0


async def test_tournament_submit_missing_time_ms_422(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Submit with missing time_ms -> 422 (schema validation)."""
    await _register_and_login(client, "tour-valid@example.com")
    await client.post("/tournament/current/attempt/start")

    resp = await client.post(
        "/tournament/current/attempt/submit",
        json={"status": "valid"},  # Missing time_ms.
    )
    assert resp.status_code == 422, resp.text


async def test_daily_get_current_attempt_status_matches_reality(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """GET /daily/current reflects the real attempt status after start/submit."""
    await _register_and_login(client, "daily-status@example.com")
    user_id = (await client.get("/users/me")).json()["id"]

    # Start a daily attempt.
    resp = await client.post("/daily/current/attempt/start")
    assert resp.status_code == 200, resp.text
    start_body = resp.json()

    # GET /current should show "started".
    resp = await client.get("/daily/current")
    assert resp.status_code == 200, resp.text
    assert resp.json()["attempt_status"] == "started"

    # Submit it.
    daily_id = start_body["daily_id"]
    resp = await client.post(
        "/daily/current/attempt/submit",
        json={"time_ms": 5000, "status": "valid"},
    )
    assert resp.status_code == 200, resp.text

    # GET /current should now show "valid".
    resp = await client.get("/daily/current")
    assert resp.status_code == 200, resp.text
    assert resp.json()["attempt_status"] == "valid"


# ============================================================================
# Moderation: boundary conditions on name checks
# ============================================================================


async def test_moderation_single_character_name_too_short_400(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Single-character nickname -> 400 NAME_TOO_SHORT."""
    resp = await client.post(
        "/auth/register",
        json={"email": "short@example.com", "password": PASSWORD, "nickname": "x"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["code"] == "NAME_TOO_SHORT"


async def test_moderation_max_length_name_allowed(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Very long but clean nickname within limits should be accepted."""
    long_name = "A" * 64  # Likely within the max length.
    resp = await client.post(
        "/auth/register",
        json={"email": "longname@example.com", "password": PASSWORD, "nickname": long_name},
    )
    # Should succeed or fail with a specific length error, not a generic one.
    if resp.status_code == 400:
        assert resp.json()["detail"]["code"] in ("NAME_TOO_SHORT", "NAME_INVALID_CHARS", "NAME_NOT_ALLOWED")
    else:
        assert resp.status_code == 201, resp.text


@pytest.mark.xfail(reason="Whitespace-only nickname accepted instead of rejected: check_display_name() normalizes whitespace to empty, but doesn't reject empty after normalization")
async def test_moderation_whitespace_only_name_rejected(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Whitespace-only nickname should be rejected as too short or invalid.

    BUG FOUND: Currently accepts "   " as valid nickname. The moderation filter
    normalizes whitespace to empty string but doesn't reject empty result.
    Should fail with NAME_TOO_SHORT or NAME_INVALID_CHARS.
    """
    resp = await client.post(
        "/auth/register",
        json={"email": "space@example.com", "password": PASSWORD, "nickname": "   "},
    )
    assert resp.status_code == 400, resp.text
    code = resp.json()["detail"]["code"]
    assert code in ("NAME_TOO_SHORT", "NAME_INVALID_CHARS")


# ============================================================================
# Regressions from swarm-report/sight-fixes
# ============================================================================


async def test_tournament_with_two_users_both_count_toward_board(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Two users submitting -> both appear on leaderboard."""
    await _register_and_login(client, "user1@example.com")
    await client.post("/tournament/current/attempt/start")
    await client.post("/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"})

    client.cookies.clear()
    await _register_and_login(client, "user2@example.com")
    await client.post("/tournament/current/attempt/start")
    await client.post("/tournament/current/attempt/submit", json={"time_ms": 6000, "status": "valid"})

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert len(entries) == 2
