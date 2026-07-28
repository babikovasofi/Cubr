"""WCA-style average of 5 (Ao5) over a user's most recent solves.

Why this exists: `users.best_ao5_ms` shipped as a column back in Stage 2 and
nothing ever wrote to it — the profile's "Лучший Ao5" card was permanently "—".
This is the setter.

WCA rules, as cubers expect them:

* an average of 5 drops the fastest AND the slowest attempt, and means the
  remaining three;
* a DNF is "slower than any time" — one DNF is simply the dropped worst, so a
  single DNF does NOT ruin the average;
* two or more DNFs make the average itself a DNF (no number).

Scope decisions:

* Only ``valid`` and ``dnf`` count as attempts. ``rejected`` is not a slow
  attempt, it is a non-attempt (the ritual was not honoured), so it is skipped
  entirely rather than treated as a DNF.
* "Last five" means the five most recent attempts by ``created_at`` — a rolling
  window, not a fixed session, because Cubr has no session concept.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Solve

AVERAGE_SIZE = 5


def ao5(times_ms: list[int | None]) -> int | None:
    """Average of exactly ``AVERAGE_SIZE`` attempts; ``None`` entries are DNFs.

    Returns milliseconds (rounded), or ``None`` when the average is a DNF or
    there are not enough attempts.
    """
    if len(times_ms) != AVERAGE_SIZE:
        return None
    dnfs = sum(1 for t in times_ms if t is None)
    if dnfs >= 2:
        return None

    finished = sorted(t for t in times_ms if t is not None)
    if dnfs == 1:
        # The single DNF IS the dropped worst; drop the fastest of the rest.
        counted = finished[1:]
    else:
        counted = finished[1:-1]

    return round(sum(counted) / len(counted))


async def current_ao5(session: AsyncSession, user_id: UUID) -> int | None:
    """Ao5 over the caller's five most recent attempts (valid/dnf only)."""
    stmt = (
        select(Solve.time_ms, Solve.status)
        .where(Solve.user_id == user_id, Solve.status.in_(("valid", "dnf")))
        .order_by(Solve.created_at.desc(), Solve.id.desc())
        .limit(AVERAGE_SIZE)
    )
    rows = (await session.execute(stmt)).all()
    times: list[int | None] = [None if status == "dnf" else time_ms for time_ms, status in rows]
    return ao5(times)
