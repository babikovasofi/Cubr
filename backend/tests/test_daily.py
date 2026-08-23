"""Daily-scramble REST + service (`app.routers.daily` / `app.services.daily`).

Mirrors tests/test_tournament.py. Covers auth, get-or-create idempotency, П8
scramble secrecy, the deadline-forced-dnf submit, the de-ranked board (П10), and
the §П5 PB-invariant (a daily flow writes zero solves).
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Solve, User
from app.models.daily import DailyAttempt, DailyChallenge
from tests.conftest import EmailSpy

settings = get_settings()


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    client.cookies.clear()
    await _register_and_login(client, email)


# --- auth gate ---


async def test_endpoints_require_auth(client: AsyncClient) -> None:
    assert (await client.get("/daily/current")).status_code == 401
    assert (await client.get("/daily/current/board")).status_code == 401
    assert (await client.post("/daily/current/attempt/start")).status_code == 401
    assert (
        await client.post(
            "/daily/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
        )
    ).status_code == 401


# --- start: create + fields + one challenge ---


async def test_first_start_creates_challenge_and_attempt(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "d-first@example.com")
    resp = await client.post("/daily/current/attempt/start")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "started"
    assert body["honesty"] == "pending"
    assert body["time_ms"] is None
    assert isinstance(body["scramble"], str) and body["scramble"] != ""
    assert body["event"] == "333"
    assert body["day_label"] == body["date"]

    async with session_maker() as session:
        n = await session.scalar(select(func.count()).select_from(DailyChallenge))
    assert n == 1


async def test_start_is_idempotent_same_attempt_and_scramble(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "d-idem@example.com")
    first = (await client.post("/daily/current/attempt/start")).json()
    second = (await client.post("/daily/current/attempt/start")).json()
    assert first["id"] == second["id"]
    assert first["scramble"] == second["scramble"]
    async with session_maker() as session:
        n_challenge = await session.scalar(select(func.count()).select_from(DailyChallenge))
        n_attempt = await session.scalar(select(func.count()).select_from(DailyAttempt))
    assert n_challenge == 1 and n_attempt == 1


# --- П8: scramble only in start/submit, never current/board ---


async def test_current_has_no_scramble_and_no_create(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "d-current@example.com")
    resp = await client.get("/daily/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "scramble" not in body
    assert body["attempt_status"] is None
    assert body["deadline_at"] is None
    # read-only: nothing created
    async with session_maker() as session:
        n = await session.scalar(select(func.count()).select_from(DailyChallenge))
    assert n == 0


async def test_current_after_start_has_deadline_no_scramble(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, "d-deadline@example.com")
    started = (await client.post("/daily/current/attempt/start")).json()
    body = (await client.get("/daily/current")).json()
    assert "scramble" not in body
    assert body["attempt_status"] == "started"
    assert body["deadline_at"] is not None
    started_at = datetime.fromisoformat(started["started_at"])
    deadline = datetime.fromisoformat(body["deadline_at"])
    assert deadline - started_at == timedelta(seconds=settings.DAILY_ATTEMPT_WINDOW_SECONDS)


async def test_board_has_no_scramble(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-boardsecrecy@example.com")
    body = (await client.get("/daily/current/board")).json()
    assert "scramble" not in body


# --- submit ---


async def test_submit_valid_records_result(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-submit@example.com")
    await client.post("/daily/current/attempt/start")
    resp = await client.post(
        "/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "valid"
    assert body["time_ms"] == 4200
    assert body["honesty"] == "pending"


async def test_submit_404_no_challenge(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-nochallenge@example.com")
    resp = await client.post(
        "/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"}
    )
    assert resp.status_code == 404, resp.text


async def test_submit_404_no_attempt(client: AsyncClient, email_spy: EmailSpy) -> None:
    # user A starts (creates today's challenge); user B has no attempt.
    await _register_and_login(client, "d-hasA@example.com")
    await client.post("/daily/current/attempt/start")
    await _switch_user(client, "d-noattempt@example.com")
    resp = await client.post(
        "/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"}
    )
    assert resp.status_code == 404, resp.text


async def test_submit_409_when_terminal(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-terminal@example.com")
    await client.post("/daily/current/attempt/start")
    assert (
        await client.post(
            "/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"}
        )
    ).status_code == 200
    resp = await client.post(
        "/daily/current/attempt/submit", json={"time_ms": 9999, "status": "valid"}
    )
    assert resp.status_code == 409, resp.text


async def test_submit_past_deadline_forced_dnf(
    client: AsyncClient, email_spy: EmailSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _register_and_login(client, "d-late@example.com")
    started = (await client.post("/daily/current/attempt/start")).json()
    challenge_date = date.fromisoformat(started["date"])
    # Freeze the "current day" to the challenge's date (so submit still finds it)
    # but advance the clock well past the attempt window → forced dnf.
    monkeypatch.setattr("app.services.daily.current_day", lambda now=None: challenge_date)
    monkeypatch.setattr(
        "app.services.daily.now_utc",
        lambda: (
            datetime.now(timezone.utc)
            + timedelta(seconds=settings.DAILY_ATTEMPT_WINDOW_SECONDS + 60)
        ),
    )
    resp = await client.post(
        "/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "dnf"  # forced despite payload "valid"


# --- board ---


async def test_board_empty_day(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-empty@example.com")
    body = (await client.get("/daily/current/board")).json()
    assert body["entries"] == []
    assert body["valid_count"] == 0
    assert body["dnf_count"] == 0
    assert body["your_entry"] is None


async def test_board_valid_entry_deranked_no_pii(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, "d-board@example.com")
    await client.post("/daily/current/attempt/start")
    await client.post("/daily/current/attempt/submit", json={"time_ms": 3000, "status": "valid"})
    body = (await client.get("/daily/current/board")).json()
    assert body["valid_count"] == 1
    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["display_name"] == "Аноним"  # no handle set
    assert entry["time_ms"] == 3000
    assert entry["is_self"] is True
    assert "rank" not in entry  # de-ranked
    assert "email" not in entry and "nickname" not in entry
    assert body["your_entry"]["time_ms"] == 3000


# --- §П5 PB-invariant: a daily flow writes zero solves ---


async def test_daily_flow_writes_zero_solves(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    await _register_and_login(client, "d-pb@example.com")
    await client.post("/daily/current/attempt/start")
    await client.post("/daily/current/attempt/submit", json={"time_ms": 4200, "status": "valid"})
    async with session_maker() as session:
        n_solves = await session.scalar(select(func.count()).select_from(Solve))
        best = await session.scalar(
            select(User.best_single_ms).where(User.email == "d-pb@example.com")
        )
    assert n_solves == 0
    assert best is None
