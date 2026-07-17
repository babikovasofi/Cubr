"""Weekly-tournament lifecycle: get-or-create the current ISO-week tournament
+ the caller's attempt at it, idempotently under concurrent races.

Plumbing only (this brick): ``time_ms`` is self-reported and every attempt's
``honesty`` stays "pending" — nothing here ever verifies or rejects a result.
See ``swarm-report/tournament-attempt-plan.md``.

Idempotency: each get-or-create is SELECT-then-insert, with the insert wrapped
in ``session.begin_nested()`` (a SAVEPOINT). If a concurrent request wins the
UNIQUE race first, only that nested SAVEPOINT rolls back — NOT the whole
session/transaction — and we re-SELECT the winning row. This is deliberately
different from the whole-session rollback in ``routers/solves.py``'s nonce
race: that call site owns the entire request transaction up to that point,
this one must preserve a possibly-already-flushed sibling insert alongside it
(e.g. the tournament get-or-create followed by the attempt get-or-create in
the same request).
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tournament import Tournament, TournamentAttempt
from app.services.scramble import random_scramble

EVENT = "333"


def now_utc() -> datetime:
    """Centralized clock. Tests monkeypatch this (``app.services.tournament.now_utc``)
    or pass an explicit ``now`` to the functions below to freeze/inject time.
    """
    return datetime.now(timezone.utc)


def current_iso_week(now: datetime | None = None) -> tuple[int, int]:
    """Return ``(iso_year, iso_week)`` for ``now`` (UTC, defaults to ``now_utc()``).

    Uses ``date.isocalendar()`` — ISO-8601 week numbering, where the ISO year
    can differ from the calendar year around Dec 31 / Jan 1 (e.g. Dec 31 2029
    falls in ISO week 1 of 2030), and some years have 53 ISO weeks (e.g. 2026).
    """
    moment = now if now is not None else now_utc()
    iso_year, iso_week, _ = moment.isocalendar()
    return iso_year, iso_week


def week_label(iso_year: int, iso_week: int) -> str:
    """Zero-padded ``"YYYY-Www"`` label, e.g. ``"2026-W05"``, ``"2020-W53"``."""
    return f"{iso_year:04d}-W{iso_week:02d}"


async def get_or_create_current_tournament(
    session: AsyncSession, now: datetime | None = None
) -> Tournament:
    """Get-or-create the ``Tournament`` row for the current ISO week.

    One shared scramble is rolled ONCE per week, the moment the first authed
    caller of that week starts an attempt.
    """
    iso_year, iso_week = current_iso_week(now)

    result = await session.execute(
        select(Tournament).where(Tournament.iso_year == iso_year, Tournament.iso_week == iso_week)
    )
    tournament = result.scalar_one_or_none()
    if tournament is not None:
        return tournament

    try:
        async with session.begin_nested():
            tournament = Tournament(
                iso_year=iso_year,
                iso_week=iso_week,
                event=EVENT,
                scramble=random_scramble(),
            )
            session.add(tournament)
            await session.flush()
    except IntegrityError:
        # Lost the (iso_year, iso_week) UNIQUE race — the SAVEPOINT above
        # rolled back only this failed insert. Re-SELECT the winner.
        result = await session.execute(
            select(Tournament).where(
                Tournament.iso_year == iso_year, Tournament.iso_week == iso_week
            )
        )
        tournament = result.scalar_one()
    return tournament


async def get_or_create_attempt(
    session: AsyncSession, user_id: uuid.UUID, tournament_id: uuid.UUID
) -> TournamentAttempt:
    """Get-or-create the caller's ``TournamentAttempt`` for ``tournament_id``.

    A second call for the same (user, tournament) reloads the existing row
    (same status, same scramble via the caller's tournament lookup) — no new
    row, no re-roll.
    """
    result = await session.execute(
        select(TournamentAttempt).where(
            TournamentAttempt.user_id == user_id,
            TournamentAttempt.tournament_id == tournament_id,
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is not None:
        return attempt

    try:
        async with session.begin_nested():
            attempt = TournamentAttempt(user_id=user_id, tournament_id=tournament_id)
            session.add(attempt)
            await session.flush()
    except IntegrityError:
        # Lost the (user_id, tournament_id) UNIQUE race — same SAVEPOINT
        # pattern as above.
        result = await session.execute(
            select(TournamentAttempt).where(
                TournamentAttempt.user_id == user_id,
                TournamentAttempt.tournament_id == tournament_id,
            )
        )
        attempt = result.scalar_one()
    return attempt


async def get_current_attempt(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> tuple[Tournament | None, TournamentAttempt | None]:
    """Read-only lookup of the current-week tournament + this user's attempt.

    Unlike ``get_or_create_current_tournament``/``get_or_create_attempt``,
    this NEVER creates anything: it SELECTs the current ISO-week ``Tournament``
    (``None`` if this week's first ``start`` hasn't happened yet) and, only if
    that exists, SELECTs the caller's ``TournamentAttempt`` (``None`` if this
    user hasn't started one). Backs ``GET /tournament/current`` — a route that
    must never start the deadline clock or reveal the scramble (П8).
    """
    iso_year, iso_week = current_iso_week(now)

    result = await session.execute(
        select(Tournament).where(Tournament.iso_year == iso_year, Tournament.iso_week == iso_week)
    )
    tournament = result.scalar_one_or_none()
    if tournament is None:
        return None, None

    attempt_result = await session.execute(
        select(TournamentAttempt).where(
            TournamentAttempt.user_id == user_id,
            TournamentAttempt.tournament_id == tournament.id,
        )
    )
    attempt = attempt_result.scalar_one_or_none()
    return tournament, attempt


def is_past_deadline(attempt: TournamentAttempt, now: datetime, window_seconds: int) -> bool:
    """Whether ``now`` is past ``attempt.started_at + window_seconds``.

    ``started_at`` is ``DateTime(timezone=True)`` with ``server_default=func.now()``
    (UTC on the wire either way), but sqlite (tests) hands back a **naive**
    datetime after flush while Postgres hands back a tz-aware one. ``now`` may
    likewise be naive (e.g. a test-frozen clock, or a value round-tripped
    through a naive-datetime JSON field). Normalize both to UTC before
    comparing — naive/aware comparison raises ``TypeError`` otherwise.
    """
    started_at = attempt.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    deadline = started_at + timedelta(seconds=window_seconds)
    return now > deadline
