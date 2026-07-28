"""Funnel counters derived from rows the product already writes (Stage 6).

No events, no tracker, no new table, no migration: every step of
"регистрация → первая сборка → первая дуэль" is a `SELECT COUNT(DISTINCT …)`
over data that exists because the feature ran, not because analytics asked.

Two consequences worth remembering:

* It is a funnel of **states**, not events — "ever did X", never "dropped off
  at step 3 of the ritual". An event stream belongs to the honesty brick
  (client timestamps are needed there anyway), not here.
* Nothing user-identifying leaves this module: the caller gets integers only
  (П10 — the public landing page promises no tracking).
"""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Cube,
    DailyAttempt,
    DuelParticipant,
    DuelRoom,
    Solve,
    TournamentAttempt,
    User,
)
from app.services.tournament import now_utc


async def _count(session: AsyncSession, stmt: Select[tuple[int]]) -> int:
    return int((await session.execute(stmt)).scalar_one() or 0)


async def collect_funnel(session: AsyncSession, now: datetime | None = None) -> dict[str, Any]:
    """All counters in one pass. ``now`` is injectable so tests can freeze time."""
    moment = now if now is not None else now_utc()
    week_ago = moment - timedelta(days=7)
    month_ago = moment - timedelta(days=30)

    users_total = await _count(session, select(func.count()).select_from(User))
    users_verified = await _count(
        # `User.is_verified` приходит из fastapi-users как обычный bool-атрибут для
        # тайпчекера, поэтому условие строим через колонку таблицы.
        session,
        select(func.count()).select_from(User).where(User.__table__.c.is_verified.is_(True)),
    )

    # DISTINCT user_id: "сколько людей дошли до шага", а не "сколько строк написано".
    users_with_cube = await _count(session, select(func.count(func.distinct(Cube.user_id))))
    users_with_solve = await _count(session, select(func.count(func.distinct(Solve.user_id))))
    users_with_tournament = await _count(
        session, select(func.count(func.distinct(TournamentAttempt.user_id)))
    )
    users_with_daily = await _count(
        session, select(func.count(func.distinct(DailyAttempt.user_id)))
    )
    users_with_duel = await _count(
        session, select(func.count(func.distinct(DuelParticipant.user_id)))
    )

    solves_total = await _count(session, select(func.count()).select_from(Solve))
    duels_finished = await _count(
        session,
        select(func.count()).select_from(DuelRoom).where(DuelRoom.status == "finished"),
    )

    signups_7d = await _count(
        session, select(func.count()).select_from(User).where(User.created_at >= week_ago)
    )
    signups_30d = await _count(
        session, select(func.count()).select_from(User).where(User.created_at >= month_ago)
    )

    # "Активен" = сделал хоть что-то из ритуальных действий за неделю. Считаем по
    # union-у user_id из четырёх источников, а не по колонке last_seen (её нет и
    # заводить её ради аналитики — это уже трекинг).
    recent_actors = (
        select(Solve.user_id.label("user_id")).where(Solve.created_at >= week_ago)
    ).union(
        select(TournamentAttempt.user_id.label("user_id")).where(
            TournamentAttempt.started_at >= week_ago
        ),
        select(DailyAttempt.user_id.label("user_id")).where(DailyAttempt.started_at >= week_ago),
        select(DuelParticipant.user_id.label("user_id")).where(
            DuelParticipant.created_at >= week_ago
        ),
    )
    active_7d = await _count(
        session, select(func.count(func.distinct(recent_actors.subquery().c.user_id)))
    )

    return {
        "users_total": users_total,
        "users_verified": users_verified,
        "users_with_cube": users_with_cube,
        "users_with_solve": users_with_solve,
        "users_with_tournament": users_with_tournament,
        "users_with_daily": users_with_daily,
        "users_with_duel": users_with_duel,
        "solves_total": solves_total,
        "duels_finished": duels_finished,
        "signups_7d": signups_7d,
        "signups_30d": signups_30d,
        "active_7d": active_7d,
        "generated_at": moment,
    }
