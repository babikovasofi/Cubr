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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.tournament import Tournament, TournamentAttempt
from app.models.user import User
from app.schemas.tournament import StandingEntry
from app.services.scramble import random_scramble

EVENT = "333"

ANONYMOUS_DISPLAY_NAME = "Аноним"


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
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime | None = None,
    window_seconds: int | None = None,
) -> tuple[Tournament | None, TournamentAttempt | None]:
    """Read-only lookup of the current-week tournament + this user's attempt.

    Unlike ``get_or_create_current_tournament``/``get_or_create_attempt``,
    this NEVER creates anything: it SELECTs the current ISO-week ``Tournament``
    (``None`` if this week's first ``start`` hasn't happened yet) and, only if
    that exists, SELECTs the caller's ``TournamentAttempt`` (``None`` if this
    user hasn't started one). Backs ``GET /tournament/current`` — a route that
    must never start the deadline clock or reveal the scramble (П8).

    View-level normalization: if the attempt is still ``"started"`` but past
    its deadline (``is_past_deadline``), the returned attempt reports
    ``status == "dnf"`` so callers never see a live-looking expired attempt
    between finalize-job runs. This NEVER mutates the persistent row: the
    view is a fresh, never-``session.add()``-ed ``TournamentAttempt`` built
    via the constructor (its own independent ``InstanceState``, not linked to
    the persisted identity-map entry) — NOT a ``copy.copy()`` of the loaded
    instance, which would share the original's ``_sa_instance_state`` and
    mark the real row dirty in ``session.dirty`` the moment ``.status`` is
    set on the "copy" (harmless only as long as this read path never
    commits). Only ``sweep_expired_attempts`` (run by the finalize job)
    actually persists the transition.
    """
    effective_now = now if now is not None else now_utc()
    window = (
        window_seconds
        if window_seconds is not None
        else get_settings().TOURNAMENT_ATTEMPT_WINDOW_SECONDS
    )
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
    if (
        attempt is not None
        and attempt.status == "started"
        and is_past_deadline(attempt, effective_now, window)
    ):
        # Transient (never session.add()-ed) instance — its own InstanceState,
        # never registered in the session's identity map, so setting `.status`
        # here cannot mark the persisted row dirty. Deliberately not a
        # copy.copy() of `attempt` (see docstring above).
        view_attempt = TournamentAttempt(
            id=attempt.id,
            user_id=attempt.user_id,
            tournament_id=attempt.tournament_id,
            status="dnf",
            honesty=attempt.honesty,
            time_ms=attempt.time_ms,
            started_at=attempt.started_at,
            submitted_at=attempt.submitted_at,
        )
        return tournament, view_attempt
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


async def sweep_expired_attempts(session: AsyncSession, now: datetime, window_seconds: int) -> int:
    """Idempotently flip every expired ``started`` attempt (any tournament,
    any week) to ``dnf``. Pure — no commit; the caller owns the transaction
    (the finalize job commits after calling this).

    SELECTs every ``started`` attempt (joined to its ``Tournament``; the join
    itself is not currently a filter — every attempt has a tournament via the
    FK — but keeps the query shaped for a future per-tournament refinement),
    then reuses the same tested ``is_past_deadline`` datetime-normalization
    helper the submit route uses to decide which are actually expired. No ids
    expired -> return 0 without issuing an UPDATE.

    The bulk UPDATE re-guards ``status == "started"`` (in addition to
    ``id.in_(ids)``): a row already flipped between the SELECT and the UPDATE
    — by a concurrent sweep, or by a user's own submit committing in that
    window — simply matches 0 rows for that id and is left alone. This makes
    the sweep safe to run at any frequency, overlapping, from any number of
    external triggers, without double-counting or clobbering a real result.
    """
    result = await session.execute(
        select(TournamentAttempt)
        .join(Tournament, TournamentAttempt.tournament_id == Tournament.id)
        .where(TournamentAttempt.status == "started")
    )
    started_attempts = result.scalars().all()
    expired_ids = [
        attempt.id for attempt in started_attempts if is_past_deadline(attempt, now, window_seconds)
    ]
    if not expired_ids:
        return 0

    update_result = cast(
        "CursorResult[Any]",
        await session.execute(
            update(TournamentAttempt)
            .where(TournamentAttempt.id.in_(expired_ids), TournamentAttempt.status == "started")
            .values(status="dnf", submitted_at=now)
        ),
    )
    # `.execute()` is typed `Result[Any]`; for a Core UPDATE it's actually a
    # `CursorResult` (which has `rowcount`) at runtime — cast for mypy strict.
    return update_result.rowcount


def display_name_for(public_handle: str | None) -> str:
    """The de-ranked board's display name for a user.

    ALWAYS ``public_handle`` (deliberately, opt-in set by the user) or the
    literal "Аноним" when unset — NEVER the account email or the
    email-derived ``nickname`` (П10 / privacy). Callers must not substitute
    any other user field here.
    """
    return public_handle or ANONYMOUS_DISPLAY_NAME


@dataclass
class TournamentStandings:
    """Raw result of ``get_current_standings``, converted to
    ``app.schemas.tournament.TournamentStandingsRead`` by the router (which
    adds the derived ``week_label``).
    """

    iso_year: int
    iso_week: int
    event: str
    entries: list[StandingEntry]
    your_entry: StandingEntry | None
    valid_count: int
    dnf_count: int


async def get_current_standings(
    session: AsyncSession, viewer_id: uuid.UUID, limit: int, now: datetime | None = None
) -> TournamentStandings:
    """Read-only current-ISO-week participation board.

    NEVER selects ``User.email`` or ``User.nickname`` — only
    ``User.public_handle`` (П10). No tournament yet this week -> empty board,
    zero counts, ``your_entry`` ``None`` (never a 404/500).

    Entries are ``status=="valid"`` attempts ordered by ``submitted_at ASC,
    id ASC``, capped at ``limit``. ``your_entry`` is the caller's own valid
    attempt regardless of whether it falls within that ``limit`` window.
    """
    iso_year, iso_week = current_iso_week(now)

    tournament_result = await session.execute(
        select(Tournament).where(Tournament.iso_year == iso_year, Tournament.iso_week == iso_week)
    )
    tournament = tournament_result.scalar_one_or_none()
    if tournament is None:
        return TournamentStandings(
            iso_year=iso_year,
            iso_week=iso_week,
            event=EVENT,
            entries=[],
            your_entry=None,
            valid_count=0,
            dnf_count=0,
        )

    entries_result = await session.execute(
        select(TournamentAttempt.user_id, TournamentAttempt.time_ms, User.public_handle)
        .join(User, TournamentAttempt.user_id == User.id)
        .where(
            TournamentAttempt.tournament_id == tournament.id,
            TournamentAttempt.status == "valid",
        )
        .order_by(TournamentAttempt.submitted_at.asc(), TournamentAttempt.id.asc())
        .limit(limit)
    )
    entries = [
        StandingEntry(
            display_name=display_name_for(public_handle),
            time_ms=time_ms if time_ms is not None else 0,
            is_self=(user_id == viewer_id),
        )
        for user_id, time_ms, public_handle in entries_result.all()
    ]

    valid_count_result = await session.execute(
        select(func.count())
        .select_from(TournamentAttempt)
        .where(
            TournamentAttempt.tournament_id == tournament.id,
            TournamentAttempt.status == "valid",
        )
    )
    valid_count = valid_count_result.scalar_one()

    dnf_count_result = await session.execute(
        select(func.count())
        .select_from(TournamentAttempt)
        .where(
            TournamentAttempt.tournament_id == tournament.id,
            TournamentAttempt.status == "dnf",
        )
    )
    dnf_count = dnf_count_result.scalar_one()

    your_result = await session.execute(
        select(TournamentAttempt.time_ms, User.public_handle)
        .join(User, TournamentAttempt.user_id == User.id)
        .where(
            TournamentAttempt.tournament_id == tournament.id,
            TournamentAttempt.user_id == viewer_id,
            TournamentAttempt.status == "valid",
        )
    )
    your_row = your_result.one_or_none()
    your_entry = (
        StandingEntry(
            display_name=display_name_for(your_row.public_handle),
            time_ms=your_row.time_ms if your_row.time_ms is not None else 0,
            is_self=True,
        )
        if your_row is not None
        else None
    )

    return TournamentStandings(
        iso_year=iso_year,
        iso_week=iso_week,
        event=tournament.event,
        entries=entries,
        your_entry=your_entry,
        valid_count=valid_count,
        dnf_count=dnf_count,
    )
