"""Daily-challenge streaks, derived — never stored (V3 "Цели и стрики").

A streak is a function of the dates a person actually finished the daily
ritual, so it is computed from `daily_challenges` × `daily_attempts` on every
read rather than kept in a counter column. No table, no migration, no job that
"repairs" streaks, and changing the rule below needs no backfill. The cost is a
query per read — for one person's history that is tens of rows.

What counts as a day of the streak
----------------------------------
The attempt was **finished by the human**: ``status == "valid"``, or
``status == "dnf"`` with a non-null ``submitted_at`` (an honest DNF is still a
completed ritual). An abandoned attempt — ``started``, later swept to ``dnf``
by `app.jobs.finalize` with no ``submitted_at`` — deliberately does NOT count,
otherwise a streak could be farmed by pressing "start" once a day.

Honesty axis is not read here: like the boards and badges, this is
participation, not a verified result.
"""

from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DailyAttempt, DailyChallenge
from app.services.daily import current_day


async def completed_days(session: AsyncSession, user_id: UUID) -> list[date]:
    """Distinct UTC dates the user finished the daily ritual, oldest first."""
    stmt = (
        select(DailyChallenge.date)
        .join(DailyAttempt, DailyAttempt.daily_id == DailyChallenge.id)
        .where(
            DailyAttempt.user_id == user_id,
            or_(
                DailyAttempt.status == "valid",
                and_(DailyAttempt.status == "dnf", DailyAttempt.submitted_at.is_not(None)),
            ),
        )
        .distinct()
        .order_by(DailyChallenge.date)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


def streak_from_days(days: list[date], today: date) -> dict[str, Any]:
    """Pure part: current/best streak out of a sorted list of completed days.

    The current streak may end **today or yesterday** — the day is not over
    yet, so a chain that ended yesterday is "at risk" (`completed_today` is
    False), not broken. A chain older than yesterday is gone.
    """
    if not days:
        return {
            "current_streak": 0,
            "best_streak": 0,
            "completed_today": False,
            "last_day": None,
        }

    best = 1
    run = 1
    for previous, current in zip(days, days[1:]):
        run = run + 1 if current - previous == timedelta(days=1) else 1
        best = max(best, run)

    last_day = days[-1]
    yesterday = today - timedelta(days=1)
    current_streak = run if last_day in (today, yesterday) else 0

    return {
        "current_streak": current_streak,
        "best_streak": best,
        "completed_today": last_day == today,
        "last_day": last_day,
    }


async def get_streak(
    session: AsyncSession, user_id: UUID, now: datetime | None = None
) -> dict[str, Any]:
    today = current_day(now)
    days = await completed_days(session, user_id)
    return {**streak_from_days(days, today), "today": today}
