"""Daily-scramble lifecycle: get-or-create the current UTC-day challenge +
the caller's attempt at it, idempotently under concurrent races.

Plumbing only (this brick): ``time_ms`` is self-reported and every attempt's
``honesty`` stays "pending" — nothing here ever verifies or rejects a result.
Parallel vertical to ``app.services.tournament`` (see
``swarm-report/daily-scramble-plan.md``) — the model-agnostic pure helpers
(``now_utc``, ``is_past_deadline``, ``display_name_for``,
``ANONYMOUS_DISPLAY_NAME``) are IMPORTED from there, not re-implemented; the
tournament vertical itself is untouched.

Idempotency: each get-or-create is SELECT-then-insert, with the insert
wrapped in ``session.begin_nested()`` (a SAVEPOINT). If a concurrent request
wins the UNIQUE race first, only that nested SAVEPOINT rolls back — NOT the
whole session/transaction — and we re-SELECT the winning row. See
``app.services.tournament`` for the full rationale.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, cast

from app.config import get_settings
from app.models.daily import DailyAttempt, DailyChallenge
from app.models.user import User
from app.schemas.daily import BoardEntry
from app.services.scramble import random_scramble
from app.services.tournament import (
    ANONYMOUS_DISPLAY_NAME,
    display_name_for,
    now_utc,
)
from app.services.tournament import is_past_deadline as _is_past_deadline

EVENT = "333"

__all__ = [
    "ANONYMOUS_DISPLAY_NAME",
    "display_name_for",
    "is_past_deadline",
    "now_utc",
]


def is_past_deadline(attempt: DailyAttempt, now: datetime, window_seconds: int) -> bool:
    """Thin structural-typing wrapper around the imported tournament helper.

    ``tournament.is_past_deadline`` only ever reads ``attempt.started_at`` at
    runtime, but its signature is pinned to ``TournamentAttempt`` — this
    wrapper re-types it for ``DailyAttempt`` (mypy strict) without
    re-implementing the datetime-normalization logic itself.
    """
    return _is_past_deadline(cast(Any, attempt), now, window_seconds)


def current_day(now: datetime | None = None) -> date:
    """Return the current UTC calendar date for ``now`` (defaults to ``now_utc()``)."""
    moment = now if now is not None else now_utc()
    return moment.date()


def day_label(d: date) -> str:
    """ISO date label, e.g. ``"2026-07-19"``."""
    return d.isoformat()


async def get_or_create_current_daily(
    session: AsyncSession, now: datetime | None = None
) -> DailyChallenge:
    """Get-or-create the ``DailyChallenge`` row for the current UTC day.

    One shared scramble is rolled ONCE per day, the moment the first authed
    caller of that day starts an attempt.
    """
    today = current_day(now)

    result = await session.execute(select(DailyChallenge).where(DailyChallenge.date == today))
    daily = result.scalar_one_or_none()
    if daily is not None:
        return daily

    try:
        async with session.begin_nested():
            daily = DailyChallenge(
                date=today,
                event=EVENT,
                scramble=random_scramble(),
            )
            session.add(daily)
            await session.flush()
    except IntegrityError:
        # Lost the (date) UNIQUE race — the SAVEPOINT above rolled back only
        # this failed insert. Re-SELECT the winner.
        result = await session.execute(select(DailyChallenge).where(DailyChallenge.date == today))
        daily = result.scalar_one()
    return daily


async def get_or_create_daily_attempt(
    session: AsyncSession, user_id: uuid.UUID, daily_id: uuid.UUID
) -> DailyAttempt:
    """Get-or-create the caller's ``DailyAttempt`` for ``daily_id``.

    A second call for the same (user, daily) reloads the existing row (same
    status, same scramble via the caller's daily lookup) — no new row, no
    re-roll.
    """
    result = await session.execute(
        select(DailyAttempt).where(
            DailyAttempt.user_id == user_id,
            DailyAttempt.daily_id == daily_id,
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is not None:
        return attempt

    try:
        async with session.begin_nested():
            attempt = DailyAttempt(user_id=user_id, daily_id=daily_id)
            session.add(attempt)
            await session.flush()
    except IntegrityError:
        # Lost the (user_id, daily_id) UNIQUE race — same SAVEPOINT pattern
        # as above.
        result = await session.execute(
            select(DailyAttempt).where(
                DailyAttempt.user_id == user_id,
                DailyAttempt.daily_id == daily_id,
            )
        )
        attempt = result.scalar_one()
    return attempt


async def get_current_daily_attempt(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime | None = None,
    window_seconds: int | None = None,
) -> tuple[DailyChallenge | None, DailyAttempt | None]:
    """Read-only lookup of today's daily challenge + this user's attempt.

    Unlike ``get_or_create_current_daily``/``get_or_create_daily_attempt``,
    this NEVER creates anything: it SELECTs today's ``DailyChallenge``
    (``None`` if today's first ``start`` hasn't happened yet) and, only if
    that exists, SELECTs the caller's ``DailyAttempt`` scoped to that
    ``daily_id`` (``None`` if this user hasn't started one today) — NEVER by
    ``user_id`` alone, so a stale prior-day attempt never leaks into today's
    read. Backs ``GET /daily/current`` — a route that must never start the
    deadline clock or reveal the scramble (П8).

    View-level normalization: if the attempt is still ``"started"`` but past
    its deadline (``is_past_deadline``), the returned attempt reports
    ``status == "dnf"`` so callers never see a live-looking expired attempt
    between finalize-job runs. This NEVER mutates the persistent row: the
    view is a fresh, never-``session.add()``-ed ``DailyAttempt`` built via
    the constructor (its own independent ``InstanceState``, not linked to
    the persisted identity-map entry) — NOT a ``copy.copy()`` of the loaded
    instance, which would share the original's ``_sa_instance_state`` and
    mark the real row dirty in ``session.dirty`` the moment ``.status`` is
    set on the "copy" (harmless only as long as this read path never
    commits). Only ``sweep_expired_daily_attempts`` (run by the finalize job)
    actually persists the transition.
    """
    effective_now = now if now is not None else now_utc()
    window = (
        window_seconds
        if window_seconds is not None
        else get_settings().DAILY_ATTEMPT_WINDOW_SECONDS
    )
    today = current_day(now)

    result = await session.execute(select(DailyChallenge).where(DailyChallenge.date == today))
    daily = result.scalar_one_or_none()
    if daily is None:
        return None, None

    attempt_result = await session.execute(
        select(DailyAttempt).where(
            DailyAttempt.user_id == user_id,
            DailyAttempt.daily_id == daily.id,
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
        view_attempt = DailyAttempt(
            id=attempt.id,
            user_id=attempt.user_id,
            daily_id=attempt.daily_id,
            status="dnf",
            honesty=attempt.honesty,
            time_ms=attempt.time_ms,
            started_at=attempt.started_at,
            submitted_at=attempt.submitted_at,
        )
        return daily, view_attempt
    return daily, attempt


async def sweep_expired_daily_attempts(
    session: AsyncSession, now: datetime, window_seconds: int
) -> int:
    """Idempotently flip every expired ``started`` daily attempt (any day) to
    ``dnf``. Pure — no commit; the caller owns the transaction (the finalize
    job commits after calling this).

    SELECTs every ``started`` attempt, then reuses the same tested
    ``is_past_deadline`` datetime-normalization helper the submit route uses
    to decide which are actually expired. No ids expired -> return 0 without
    issuing an UPDATE.

    The bulk UPDATE re-guards ``status == "started"`` (in addition to
    ``id.in_(ids)``): a row already flipped between the SELECT and the
    UPDATE — by a concurrent sweep, or by a user's own submit committing in
    that window — simply matches 0 rows for that id and is left alone. This
    makes the sweep safe to run at any frequency, overlapping, from any
    number of external triggers, without double-counting or clobbering a
    real result. Also the mechanism that finalizes a ``started`` attempt from
    a PRIOR UTC day (rollover) — it is not scoped to today's challenge.
    """
    result = await session.execute(select(DailyAttempt).where(DailyAttempt.status == "started"))
    started_attempts = result.scalars().all()
    expired_ids = [
        attempt.id for attempt in started_attempts if is_past_deadline(attempt, now, window_seconds)
    ]
    if not expired_ids:
        return 0

    update_result = cast(
        "CursorResult[Any]",
        await session.execute(
            update(DailyAttempt)
            .where(DailyAttempt.id.in_(expired_ids), DailyAttempt.status == "started")
            .values(status="dnf", submitted_at=now)
        ),
    )
    # `.execute()` is typed `Result[Any]`; for a Core UPDATE it's actually a
    # `CursorResult` (which has `rowcount`) at runtime — cast for mypy strict.
    return update_result.rowcount


@dataclass
class DailyBoard:
    """Raw result of ``get_current_daily_board``, converted to
    ``app.schemas.daily.DailyBoardRead`` by the router (which adds the
    derived ``day_label``).
    """

    date: date
    event: str
    entries: list[BoardEntry]
    your_entry: BoardEntry | None
    valid_count: int
    dnf_count: int


async def get_current_daily_board(
    session: AsyncSession, viewer_id: uuid.UUID, limit: int, now: datetime | None = None
) -> DailyBoard:
    """Read-only current-UTC-day participation board.

    NEVER selects ``User.email`` — only ``User.handle`` (П10). No daily
    challenge yet today -> empty board, zero counts, ``your_entry`` ``None``
    (never a 404/500).

    Entries are ``status=="valid"`` attempts ordered by ``submitted_at ASC,
    id ASC``, capped at ``limit``. ``your_entry`` is the caller's own valid
    attempt regardless of whether it falls within that ``limit`` window.
    """
    today = current_day(now)

    daily_result = await session.execute(select(DailyChallenge).where(DailyChallenge.date == today))
    daily = daily_result.scalar_one_or_none()
    if daily is None:
        return DailyBoard(
            date=today,
            event=EVENT,
            entries=[],
            your_entry=None,
            valid_count=0,
            dnf_count=0,
        )

    entries_result = await session.execute(
        select(DailyAttempt.user_id, DailyAttempt.time_ms, User.handle)
        .join(User, DailyAttempt.user_id == User.id)
        .where(
            DailyAttempt.daily_id == daily.id,
            DailyAttempt.status == "valid",
        )
        .order_by(DailyAttempt.submitted_at.asc(), DailyAttempt.id.asc())
        .limit(limit)
    )
    entries = [
        BoardEntry(
            display_name=display_name_for(handle),
            time_ms=time_ms if time_ms is not None else 0,
            is_self=(user_id == viewer_id),
        )
        for user_id, time_ms, handle in entries_result.all()
    ]

    valid_count_result = await session.execute(
        select(func.count())
        .select_from(DailyAttempt)
        .where(
            DailyAttempt.daily_id == daily.id,
            DailyAttempt.status == "valid",
        )
    )
    valid_count = valid_count_result.scalar_one()

    dnf_count_result = await session.execute(
        select(func.count())
        .select_from(DailyAttempt)
        .where(
            DailyAttempt.daily_id == daily.id,
            DailyAttempt.status == "dnf",
        )
    )
    dnf_count = dnf_count_result.scalar_one()

    your_result = await session.execute(
        select(DailyAttempt.time_ms, User.handle)
        .join(User, DailyAttempt.user_id == User.id)
        .where(
            DailyAttempt.daily_id == daily.id,
            DailyAttempt.user_id == viewer_id,
            DailyAttempt.status == "valid",
        )
    )
    your_row = your_result.one_or_none()
    your_entry = (
        BoardEntry(
            display_name=display_name_for(your_row.handle),
            time_ms=your_row.time_ms if your_row.time_ms is not None else 0,
            is_self=True,
        )
        if your_row is not None
        else None
    )

    return DailyBoard(
        date=today,
        event=daily.event,
        entries=entries,
        your_entry=your_entry,
        valid_count=valid_count,
        dnf_count=dnf_count,
    )
