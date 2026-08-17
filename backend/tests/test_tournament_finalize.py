"""Tests for weekly-tournament finalize: sweep_expired_attempts, get_current_attempt normalization,
and the finalize job (python -m app.jobs.finalize).

All tests use an injected `now` (never wall-clock), matching existing patterns
in test_tournament.py: frozen clocks via monkeypatch, direct-insert Tournament +
TournamentAttempt rows, and iso_week-relative fixtures.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Tournament, TournamentAttempt, User
from app.services import tournament as tournament_service
from app.jobs.finalize import run

settings = get_settings()

# Base timestamp for all tests: a Monday in an arbitrary ISO week.
# datetime(2031, 6, 8) is a Monday in ISO week 2031-W23 (2031-06-01 is week 22).
BASE_NOW = datetime(2031, 6, 8, 12, 0, 0, tzinfo=timezone.utc)


async def _insert_tournament(
    session: AsyncSession,
    iso_year: int | None = None,
    iso_week: int | None = None,
    scramble: str = "R U' D2",
) -> Tournament:
    """Helper: insert a Tournament row directly.

    If iso_year/iso_week not provided, uses current_iso_week(BASE_NOW).
    """
    if iso_year is None or iso_week is None:
        iso_year_calc, iso_week_calc = tournament_service.current_iso_week(BASE_NOW)
        iso_year = iso_year if iso_year is not None else iso_year_calc
        iso_week = iso_week if iso_week is not None else iso_week_calc
    tournament = Tournament(iso_year=iso_year, iso_week=iso_week, scramble=scramble)
    session.add(tournament)
    await session.flush()
    return tournament


async def _insert_attempt(
    session: AsyncSession,
    user_id,
    tournament_id,
    status: str = "started",
    started_at: datetime | None = None,
    submitted_at: datetime | None = None,
    time_ms: int | None = None,
) -> TournamentAttempt:
    """Helper: insert a TournamentAttempt row directly."""
    started_at = started_at or BASE_NOW
    attempt = TournamentAttempt(
        user_id=user_id,
        tournament_id=tournament_id,
        status=status,
        started_at=started_at,
        submitted_at=submitted_at,
        time_ms=time_ms,
    )
    session.add(attempt)
    await session.flush()
    return attempt


async def _insert_user(session: AsyncSession, email: str) -> User:
    """Helper: insert a User row directly."""
    user = User(email=email, hashed_password="dummy")
    session.add(user)
    await session.flush()
    return user


# --- test_sweep_flips_expired_started_to_dnf ---


async def test_sweep_flips_expired_started_to_dnf(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Current-week started attempt, started_at=now-601s, window 600 ->
    sweep(now,600) returns 1; row status="dnf", submitted_at=now.
    """
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        user = await _insert_user(session, "sweep-flip@example.com")
        tournament = await _insert_tournament(session)
        # Expired: started 601 seconds ago
        started_at = now - timedelta(seconds=601)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        await session.commit()

    # Sweep with injected `now`
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 1

    # Reload and verify
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        reloaded = result.scalar_one()

    assert reloaded.status == "dnf"
    # Normalize for comparison (SQLite naive vs aware timezone handling)
    submitted = reloaded.submitted_at
    if submitted.tzinfo is None:
        submitted = submitted.replace(tzinfo=timezone.utc)
    assert submitted == now


# --- test_sweep_ignores_not_yet_expired ---


async def test_sweep_ignores_not_yet_expired(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """started_at=now-60s, window=600 -> not expired -> sweep returns 0,
    stays started, submitted_at stays None.
    """
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        user = await _insert_user(session, "not-expired@example.com")
        tournament = await _insert_tournament(session)
        # Not expired: started 60 seconds ago
        started_at = now - timedelta(seconds=60)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        await session.commit()

    # Sweep with injected `now`
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 0

    # Reload and verify unchanged
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        reloaded = result.scalar_one()

    assert reloaded.status == "started"
    assert reloaded.submitted_at is None


# --- test_sweep_ignores_valid_and_dnf ---


async def test_sweep_ignores_valid_and_dnf(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """A valid + a dnf, both stale -> sweep returns 0, neither mutated."""
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        user1 = await _insert_user(session, "valid@example.com")
        user2 = await _insert_user(session, "dnf@example.com")
        tournament = await _insert_tournament(session)

        # Stale valid attempt
        old_time = now - timedelta(seconds=3600)
        valid_attempt = await _insert_attempt(
            session,
            user1.id,
            tournament.id,
            status="valid",
            started_at=old_time,
            submitted_at=old_time,
            time_ms=5000,
        )
        valid_id = valid_attempt.id

        # Stale dnf attempt
        dnf_attempt = await _insert_attempt(
            session,
            user2.id,
            tournament.id,
            status="dnf",
            started_at=old_time,
            submitted_at=old_time,
        )
        dnf_id = dnf_attempt.id

        await session.commit()

    # Sweep should ignore both
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 0

    # Reload and verify unchanged
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id.in_([valid_id, dnf_id]))
        )
        attempts_by_id = {a.id: a for a in result.scalars().all()}

    assert len(attempts_by_id) == 2
    assert attempts_by_id[valid_id].status == "valid"
    assert attempts_by_id[valid_id].time_ms == 5000
    assert attempts_by_id[dnf_id].status == "dnf"


# --- test_sweep_sets_submitted_at_to_now ---


async def test_sweep_sets_submitted_at_to_now(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Swept row's submitted_at == injected now."""
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        user = await _insert_user(session, "submitted-at@example.com")
        tournament = await _insert_tournament(session)
        # Expired
        started_at = now - timedelta(seconds=601)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        assert attempt.submitted_at is None
        await session.commit()

    # Sweep
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 1

    # Reload and verify submitted_at is exactly the injected `now`
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        reloaded = result.scalar_one()

    assert reloaded.submitted_at is not None
    # Normalize for comparison (timezone handling)
    submitted = reloaded.submitted_at
    if submitted.tzinfo is None:
        submitted = submitted.replace(tzinfo=timezone.utc)
    assert submitted == now


# --- test_sweep_idempotent ---


async def test_sweep_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Expired started -> 1 then commit; 2nd sweep same now -> 0, row unchanged."""
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        user = await _insert_user(session, "idempotent@example.com")
        tournament = await _insert_tournament(session)
        started_at = now - timedelta(seconds=601)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        await session.commit()

    # First sweep
    async with session_maker() as session:
        swept1 = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept1 == 1

    # Reload to verify it was swept
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        after_first = result.scalar_one()

    assert after_first.status == "dnf"
    first_submitted_at = after_first.submitted_at

    # Second sweep with same now should return 0
    async with session_maker() as session:
        swept2 = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept2 == 0

    # Reload and verify unchanged
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        after_second = result.scalar_one()

    assert after_second.status == "dnf"
    assert after_second.submitted_at == first_submitted_at


# --- test_sweep_empty_db_returns_zero ---


async def test_sweep_empty_db_returns_zero(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """No attempts -> sweep returns 0, no error."""
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 0


# --- test_sweep_mixed_batch_counts_only_expired ---


async def test_sweep_mixed_batch_counts_only_expired(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Expired-started + fresh-started + valid + dnf -> returns 1 (only expired started);
    assert exactly that one is dnf, others untouched.
    """
    now = BASE_NOW
    window = 600

    async with session_maker() as session:
        users = [await _insert_user(session, f"user{i}@example.com") for i in range(4)]
        tournament = await _insert_tournament(session)

        # Expired started
        expired_started = await _insert_attempt(
            session,
            users[0].id,
            tournament.id,
            status="started",
            started_at=now - timedelta(seconds=601),
        )
        expired_id = expired_started.id

        # Fresh started (not expired)
        fresh_started = await _insert_attempt(
            session,
            users[1].id,
            tournament.id,
            status="started",
            started_at=now - timedelta(seconds=60),
        )
        fresh_id = fresh_started.id

        # Valid (never touched)
        valid_attempt = await _insert_attempt(
            session,
            users[2].id,
            tournament.id,
            status="valid",
            submitted_at=now - timedelta(seconds=3600),
            time_ms=5000,
        )
        valid_id = valid_attempt.id

        # DNF (never touched)
        dnf_attempt = await _insert_attempt(
            session,
            users[3].id,
            tournament.id,
            status="dnf",
            submitted_at=now - timedelta(seconds=3600),
        )
        dnf_id = dnf_attempt.id

        await session.commit()

    # Sweep
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 1

    # Reload all and verify
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(
                TournamentAttempt.id.in_([expired_id, fresh_id, valid_id, dnf_id])
            )
        )
        attempts_map = {a.id: a for a in result.scalars().all()}

    # Only the expired started should now be dnf
    assert attempts_map[expired_id].status == "dnf"
    assert attempts_map[expired_id].submitted_at is not None

    # Others unchanged
    assert attempts_map[fresh_id].status == "started"
    assert attempts_map[fresh_id].submitted_at is None

    assert attempts_map[valid_id].status == "valid"
    assert attempts_map[valid_id].time_ms == 5000

    assert attempts_map[dnf_id].status == "dnf"


# --- test_finalize_run_sweeps_and_commits ---


async def test_finalize_run_sweeps_and_commits(
    session_maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Insert expired started; call await run() (monkeypatched async_session_maker);
    returns 1; row is dnf when read back in a fresh session (proves commit).
    """
    now = BASE_NOW
    window = settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS

    attempt_id = None
    async with session_maker() as session:
        user = await _insert_user(session, "finalize-run@example.com")
        tournament = await _insert_tournament(session)
        started_at = now - timedelta(seconds=window + 1)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        await session.commit()

    # Monkeypatch now_utc and async_session_maker so run() uses test fixtures
    # now_utc is imported directly in the finalize module, so patch it there
    import app.jobs.finalize as finalize_module

    monkeypatch.setattr(finalize_module, "now_utc", lambda: now)
    # async_session_maker is imported inside run() from app.db, so patch it there
    monkeypatch.setattr("app.db.async_session_maker", session_maker)

    # Call run()
    swept = await run()

    assert swept == 1

    # Reload in a FRESH session and verify the commit persisted
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        reloaded = result.scalar_one()

    assert reloaded.status == "dnf"
    assert reloaded.submitted_at is not None


# --- test_get_current_attempt_normalizes_expired_started_to_dnf ---


async def test_get_current_attempt_normalizes_expired_started_to_dnf(
    session_maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Caller has a started attempt past its deadline; get_current_attempt reports
    attempt_status="dnf" (view-level) while the DB row is untouched (still started
    until the job runs).
    """
    now = BASE_NOW
    window = settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS

    async with session_maker() as session:
        user = await _insert_user(session, "normalize@example.com")
        tournament = await _insert_tournament(session)
        # Expired started
        started_at = now - timedelta(seconds=window + 1)
        attempt = await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        attempt_id = attempt.id
        await session.commit()

    # Monkeypatch now_utc for get_current_attempt
    monkeypatch.setattr(tournament_service, "now_utc", lambda: now)

    # Call get_current_attempt with the same now/window
    async with session_maker() as session:
        tournament_read, attempt_read = await tournament_service.get_current_attempt(
            session, user.id, now=now, window_seconds=window
        )

    assert tournament_read is not None
    assert attempt_read is not None
    # View-level shows dnf
    assert attempt_read.status == "dnf"

    # But the DB row is still started (read-only, never wrote)
    async with session_maker() as session:
        result = await session.execute(
            select(TournamentAttempt).where(TournamentAttempt.id == attempt_id)
        )
        db_row = result.scalar_one()

    assert db_row.status == "started"
    assert db_row.submitted_at is None


# --- test_standings_dnf_count_after_sweep ---


async def test_standings_dnf_count_after_sweep(
    session_maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Expired started attempt: before sweep it's in neither entries nor dnf_count;
    after sweep+commit it's in dnf_count, still absent from valid entries.
    """
    now = BASE_NOW
    window = settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS

    async with session_maker() as session:
        user = await _insert_user(session, "standings@example.com")
        tournament = await _insert_tournament(session)
        # Expired started
        started_at = now - timedelta(seconds=window + 1)
        await _insert_attempt(
            session, user.id, tournament.id, status="started", started_at=started_at
        )
        await session.commit()

    # Monkeypatch for get_current_standings
    monkeypatch.setattr(tournament_service, "now_utc", lambda: now)

    # Before sweep: check standings
    async with session_maker() as session:
        standings_before = await tournament_service.get_current_standings(
            session, user.id, limit=100, now=now
        )

    # Expired started is not yet in dnf_count (it's still started in DB)
    assert standings_before.dnf_count == 0
    assert standings_before.valid_count == 0
    assert len(standings_before.entries) == 0

    # Sweep
    async with session_maker() as session:
        swept = await tournament_service.sweep_expired_attempts(session, now, window)
        await session.commit()

    assert swept == 1

    # After sweep: check standings again
    async with session_maker() as session:
        standings_after = await tournament_service.get_current_standings(
            session, user.id, limit=100, now=now
        )

    # Now it's in dnf_count, still absent from valid entries
    assert standings_after.dnf_count == 1
    assert standings_after.valid_count == 0
    assert len(standings_after.entries) == 0
    assert standings_after.your_entry is None
