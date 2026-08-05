"""Daily-scramble finalize: sweep_expired_daily_attempts, get_current_daily_attempt
view-normalization, cross-day rollover, and the shared finalize job sweeping BOTH
verticals. Mirrors tests/test_tournament_finalize.py; injected `now`, never wall-clock.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.jobs.finalize import run
from app.models import DailyAttempt, DailyChallenge, Tournament, TournamentAttempt, User
from app.services import daily as daily_service

settings = get_settings()

BASE_NOW = datetime(2031, 6, 8, 12, 0, 0, tzinfo=timezone.utc)


async def _insert_user(session: AsyncSession, email: str) -> User:
    user = User(email=email, hashed_password="dummy")
    session.add(user)
    await session.flush()
    return user


async def _insert_daily(session: AsyncSession, on: date, scramble: str = "R U' D2") -> DailyChallenge:
    daily = DailyChallenge(date=on, event="333", scramble=scramble)
    session.add(daily)
    await session.flush()
    return daily


async def _insert_daily_attempt(
    session: AsyncSession,
    user_id: uuid.UUID,
    daily_id: uuid.UUID,
    status: str = "started",
    started_at: datetime | None = None,
    submitted_at: datetime | None = None,
    time_ms: int | None = None,
) -> DailyAttempt:
    attempt = DailyAttempt(
        user_id=user_id,
        daily_id=daily_id,
        status=status,
        started_at=started_at or BASE_NOW,
        submitted_at=submitted_at,
        time_ms=time_ms,
    )
    session.add(attempt)
    await session.flush()
    return attempt


# --- sweep ---


async def test_sweep_flips_expired_started_to_dnf(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now, window = BASE_NOW, 600
    async with session_maker() as session:
        user = await _insert_user(session, "d-flip@example.com")
        daily = await _insert_daily(session, now.date())
        attempt = await _insert_daily_attempt(
            session, user.id, daily.id, started_at=now - timedelta(seconds=601)
        )
        aid = attempt.id
        await session.commit()

    async with session_maker() as session:
        swept = await daily_service.sweep_expired_daily_attempts(session, now, window)
        await session.commit()
    assert swept == 1

    async with session_maker() as session:
        reloaded = (
            await session.execute(select(DailyAttempt).where(DailyAttempt.id == aid))
        ).scalar_one()
    assert reloaded.status == "dnf"
    submitted = reloaded.submitted_at
    if submitted is not None and submitted.tzinfo is None:
        submitted = submitted.replace(tzinfo=timezone.utc)
    assert submitted == now


async def test_sweep_ignores_not_yet_expired(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now, window = BASE_NOW, 600
    async with session_maker() as session:
        user = await _insert_user(session, "d-fresh@example.com")
        daily = await _insert_daily(session, now.date())
        attempt = await _insert_daily_attempt(
            session, user.id, daily.id, started_at=now - timedelta(seconds=60)
        )
        aid = attempt.id
        await session.commit()

    async with session_maker() as session:
        swept = await daily_service.sweep_expired_daily_attempts(session, now, window)
        await session.commit()
    assert swept == 0

    async with session_maker() as session:
        reloaded = (
            await session.execute(select(DailyAttempt).where(DailyAttempt.id == aid))
        ).scalar_one()
    assert reloaded.status == "started"
    assert reloaded.submitted_at is None


async def test_sweep_ignores_valid_and_dnf(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now, window = BASE_NOW, 600
    old = now - timedelta(seconds=3600)
    async with session_maker() as session:
        u1 = await _insert_user(session, "d-valid@example.com")
        u2 = await _insert_user(session, "d-dnf@example.com")
        daily = await _insert_daily(session, now.date())
        v = await _insert_daily_attempt(
            session, u1.id, daily.id, status="valid", started_at=old, submitted_at=old, time_ms=5000
        )
        d = await _insert_daily_attempt(
            session, u2.id, daily.id, status="dnf", started_at=old, submitted_at=old
        )
        vid, did = v.id, d.id
        await session.commit()

    async with session_maker() as session:
        swept = await daily_service.sweep_expired_daily_attempts(session, now, window)
        await session.commit()
    assert swept == 0

    async with session_maker() as session:
        rows = {
            a.id: a
            for a in (
                await session.execute(select(DailyAttempt).where(DailyAttempt.id.in_([vid, did])))
            ).scalars()
        }
    assert rows[vid].status == "valid" and rows[vid].time_ms == 5000
    assert rows[did].status == "dnf"


async def test_sweep_idempotent(session_maker: async_sessionmaker[AsyncSession]) -> None:
    now, window = BASE_NOW, 600
    async with session_maker() as session:
        user = await _insert_user(session, "d-idem@example.com")
        daily = await _insert_daily(session, now.date())
        attempt = await _insert_daily_attempt(
            session, user.id, daily.id, started_at=now - timedelta(seconds=601)
        )
        aid = attempt.id
        await session.commit()

    async with session_maker() as session:
        assert await daily_service.sweep_expired_daily_attempts(session, now, window) == 1
        await session.commit()
    async with session_maker() as session:
        assert await daily_service.sweep_expired_daily_attempts(session, now, window) == 0
        await session.commit()
    async with session_maker() as session:
        reloaded = (
            await session.execute(select(DailyAttempt).where(DailyAttempt.id == aid))
        ).scalar_one()
    assert reloaded.status == "dnf"


async def test_sweep_empty_returns_zero(session_maker: async_sessionmaker[AsyncSession]) -> None:
    async with session_maker() as session:
        assert await daily_service.sweep_expired_daily_attempts(session, BASE_NOW, 600) == 0


# --- cross-day rollover: a PRIOR-day started attempt is swept; today's untouched ---


async def test_rollover_prior_day_swept_today_untouched(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now, window = BASE_NOW, 600
    async with session_maker() as session:
        user = await _insert_user(session, "d-rollover@example.com")
        yesterday = await _insert_daily(session, (now - timedelta(days=1)).date(), scramble="F2 B")
        today = await _insert_daily(session, now.date())
        # yesterday's attempt started long ago (expired), today's just started (fresh)
        stale = await _insert_daily_attempt(
            session, user.id, yesterday.id, started_at=now - timedelta(days=1)
        )
        u2 = await _insert_user(session, "d-rollover2@example.com")
        fresh = await _insert_daily_attempt(
            session, u2.id, today.id, started_at=now - timedelta(seconds=30)
        )
        stale_id, fresh_id = stale.id, fresh.id
        await session.commit()

    async with session_maker() as session:
        swept = await daily_service.sweep_expired_daily_attempts(session, now, window)
        await session.commit()
    assert swept == 1

    async with session_maker() as session:
        rows = {
            a.id: a
            for a in (
                await session.execute(
                    select(DailyAttempt).where(DailyAttempt.id.in_([stale_id, fresh_id]))
                )
            ).scalars()
        }
    assert rows[stale_id].status == "dnf"
    assert rows[fresh_id].status == "started"


# --- view normalization (lazy dnf, DB row untouched) ---


async def test_get_current_daily_attempt_normalizes_expired_without_mutating(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now = BASE_NOW
    window = settings.DAILY_ATTEMPT_WINDOW_SECONDS
    async with session_maker() as session:
        user = await _insert_user(session, "d-normalize@example.com")
        daily = await _insert_daily(session, now.date())
        attempt = await _insert_daily_attempt(
            session, user.id, daily.id, started_at=now - timedelta(seconds=window + 1)
        )
        aid = attempt.id
        await session.commit()

    async with session_maker() as session:
        daily_read, attempt_read = await daily_service.get_current_daily_attempt(
            session, user.id, now=now, window_seconds=window
        )
    assert daily_read is not None
    assert attempt_read is not None
    assert attempt_read.status == "dnf"  # view-level

    async with session_maker() as session:
        db_row = (
            await session.execute(select(DailyAttempt).where(DailyAttempt.id == aid))
        ).scalar_one()
    assert db_row.status == "started"  # row untouched — no copy.copy landmine
    assert db_row.submitted_at is None


# --- finalize.run() sweeps BOTH verticals in one commit ---


async def test_finalize_run_sweeps_tournament_and_daily(
    session_maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    now = BASE_NOW
    t_window = settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS
    d_window = settings.DAILY_ATTEMPT_WINDOW_SECONDS

    async with session_maker() as session:
        # stale daily started
        du = await _insert_user(session, "fr-daily@example.com")
        daily = await _insert_daily(session, now.date())
        d_attempt = await _insert_daily_attempt(
            session, du.id, daily.id, started_at=now - timedelta(seconds=d_window + 1)
        )
        d_id = d_attempt.id
        # stale tournament started
        tu = await _insert_user(session, "fr-tourn@example.com")
        from app.services import tournament as tournament_service

        iso_year, iso_week = tournament_service.current_iso_week(now)
        tournament = Tournament(iso_year=iso_year, iso_week=iso_week, scramble="R U")
        session.add(tournament)
        await session.flush()
        t_attempt = TournamentAttempt(
            user_id=tu.id,
            tournament_id=tournament.id,
            status="started",
            started_at=now - timedelta(seconds=t_window + 1),
        )
        session.add(t_attempt)
        await session.flush()
        t_id = t_attempt.id
        await session.commit()

    import app.jobs.finalize as finalize_module

    monkeypatch.setattr(finalize_module, "now_utc", lambda: now)
    monkeypatch.setattr("app.db.async_session_maker", session_maker)

    swept = await run()
    assert swept == 2  # one from each vertical, one commit

    async with session_maker() as session:
        d_row = (
            await session.execute(select(DailyAttempt).where(DailyAttempt.id == d_id))
        ).scalar_one()
        t_row = (
            await session.execute(select(TournamentAttempt).where(TournamentAttempt.id == t_id))
        ).scalar_one()
    assert d_row.status == "dnf" and d_row.submitted_at is not None
    assert t_row.status == "dnf" and t_row.submitted_at is not None
