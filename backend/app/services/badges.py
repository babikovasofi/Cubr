"""Badge award engine: a code registry (`BADGE_REGISTRY`) + evaluators fired
from the three existing write paths (`POST /solves`, tournament submit, duel
finalize).

Session discipline (skeptic HIGH#1): every function here takes the CALLER's
`AsyncSession` and writes inside the caller's own transaction — this module
NEVER opens its own session and NEVER calls `session.commit()`. The caller
commits once, atomically, alongside its primary write. For duels, "the
caller" is `app.routers.duel._on_finalize`'s own short-lived session (that
callback already owns its own commit — see that module).

Idempotency (skeptic HIGH#4): `grant` inserts inside `session.begin_nested()`
(a SAVEPOINT) and treats `IntegrityError` (the `UNIQUE(user_id, code)`
constraint on `UserBadge`) as "already held" -> `False`. Mirrors
`app.services.tournament`'s get-or-create shape.

Best-effort (skeptic HIGH#2): this module does NOT swallow its own
exceptions — every call site (`routers/solves.py`, `routers/tournament.py`,
`routers/duel.py`) wraps its `evaluate_*` call in its own
`try/except Exception: logger.exception(...); badges = []` so a badge-engine
fault never aborts the primary solve/tournament/duel write.

Honesty (skeptic HIGH#5): badges are participation/self-reported achievements
— NOTHING here reads or writes any honesty field (`Solve.verify_frames_ok`,
`*.honesty`, etc.) on any table, and awarding writes ONLY `user_badges`
(never `solves`, never `User.best_single_ms` — §П5 PB-invariant frozen).
`giant_slayer` reads `User.best_single_ms`, which is written elsewhere
(`routers/solves.py`) — this module only reads it.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.duel import DuelRoom
from app.models.tournament import TournamentAttempt
from app.models.user import User
from app.models.user_badge import UserBadge


@dataclass(frozen=True)
class BadgeDef:
    code: str
    title: str
    description: str
    icon: str


BADGE_REGISTRY: dict[str, BadgeDef] = {
    "sub_30": BadgeDef(
        code="sub_30",
        title="Меньше 30",
        description="Сборка кубика быстрее 30 секунд.",
        icon="⏱️",
    ),
    "first_duel_win": BadgeDef(
        code="first_duel_win",
        title="Первая победа",
        description="Победа в дуэли.",
        icon="🥇",
    ),
    "ten_duels": BadgeDef(
        code="ten_duels",
        title="Ветеран дуэлей",
        description="10 завершённых дуэлей.",
        icon="🔟",
    ),
    "giant_slayer": BadgeDef(
        code="giant_slayer",
        title="Гроза авторитетов",
        description="Победа над соперником с лучшим личным рекордом.",
        icon="⚔️",
    ),
    "weekly_debut": BadgeDef(
        code="weekly_debut",
        title="Дебют турнира",
        description="Первая успешная попытка в еженедельном турнире.",
        icon="📅",
    ),
}


class BadgeReadDict(TypedDict):
    code: str
    title: str
    description: str
    icon: str
    earned: bool
    earned_at: datetime | None


def registry_entry(code: str, *, earned_at: datetime | None = None) -> BadgeReadDict:
    """`BadgeReadDict` for a single freshly-granted `code`, `earned=True`.

    Used by call sites (`routers/solves.py`, `routers/tournament.py`) to
    build the `new_badges` list from the codes `grant()` reported as newly
    granted THIS event — no extra DB round-trip needed since the metadata
    lives in `BADGE_REGISTRY`, not a table.
    """
    badge = BADGE_REGISTRY[code]
    return BadgeReadDict(
        code=badge.code,
        title=badge.title,
        description=badge.description,
        icon=badge.icon,
        earned=True,
        earned_at=earned_at,
    )


async def grant(session: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Insert a `UserBadge(user_id, code)` row, idempotently.

    `code` must be a `BADGE_REGISTRY` key (asserted — a typo here is a
    programmer error, not a runtime condition to handle gracefully).
    Returns `True` iff this call actually inserted the row; `False` if the
    `UNIQUE(user_id, code)` constraint reports it was already held (the
    nested SAVEPOINT rolls back only this failed insert, not the caller's
    surrounding transaction).
    """
    assert code in BADGE_REGISTRY, f"Unknown badge code: {code!r}"
    try:
        async with session.begin_nested():
            session.add(UserBadge(user_id=user_id, code=code))
            await session.flush()
    except IntegrityError:
        return False
    return True


async def evaluate_solve(
    session: AsyncSession, user: User, status: str, time_ms: int | None
) -> list[str]:
    """`sub_30`: a valid solve under 30000ms. Returns codes newly granted by
    THIS call (not history).
    """
    granted: list[str] = []
    if status == "valid" and time_ms is not None and time_ms < 30000:
        if await grant(session, user.id, "sub_30"):
            granted.append("sub_30")
    return granted


async def evaluate_tournament_submit(
    session: AsyncSession, user: User, attempt: TournamentAttempt
) -> list[str]:
    """`weekly_debut`: the caller's first `valid` weekly-tournament submission."""
    granted: list[str] = []
    if attempt.status == "valid":
        if await grant(session, user.id, "weekly_debut"):
            granted.append("weekly_debut")
    return granted


async def _finished_duel_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Count of the player's `finished` `DuelRoom`s (player_a or player_b),
    `abandoned` excluded — backs the lazy `ten_duels` re-eval.
    """
    result = await session.execute(
        select(func.count())
        .select_from(DuelRoom)
        .where(
            DuelRoom.status == "finished",
            or_(DuelRoom.player_a_id == user_id, DuelRoom.player_b_id == user_id),
        )
    )
    return result.scalar_one()


async def evaluate_duel_finalized(
    session: AsyncSession, room: DuelRoom
) -> dict[uuid.UUID, list[str]]:
    """Evaluate every duel-related badge for a just-finalized `room`.

    Called from `app.routers.duel._on_finalize`, AFTER `finalize_room(...)`
    has set `room.status = "finished"` / `room.winner_id` on the caller's own
    session, and BEFORE that session commits.

    `ten_duels` is evaluated for both players regardless of the outcome (lazy
    re-eval: self-heals a missed threshold on a later finalize; the UNIQUE
    constraint stops a double-grant). Win badges (`first_duel_win`,
    `giant_slayer`) are skipped entirely when `room.winner_id is None` (a
    tie) — the plan's explicit tie guard.
    """
    player_ids = [room.player_a_id]
    if room.player_b_id is not None:
        player_ids.append(room.player_b_id)
    granted: dict[uuid.UUID, list[str]] = {pid: [] for pid in player_ids}

    for player_id in player_ids:
        count = await _finished_duel_count(session, player_id)
        if count >= 10 and await grant(session, player_id, "ten_duels"):
            granted[player_id].append("ten_duels")

    if room.winner_id is None or room.player_b_id is None:
        return granted  # tie, or an (impossible in practice) unjoined room

    winner_id = room.winner_id
    loser_id = room.player_b_id if winner_id == room.player_a_id else room.player_a_id

    if await grant(session, winner_id, "first_duel_win"):
        granted[winner_id].append("first_duel_win")

    winner = await session.get(User, winner_id)
    loser = await session.get(User, loser_id)
    if (
        winner is not None
        and loser is not None
        and loser.best_single_ms is not None
        and (winner.best_single_ms is None or loser.best_single_ms < winner.best_single_ms)
        and await grant(session, winner_id, "giant_slayer")
    ):
        granted[winner_id].append("giant_slayer")

    return granted


async def list_badges_for(session: AsyncSession, user_id: uuid.UUID) -> list[BadgeReadDict]:
    """The full registry for `user_id`, merged with their earned rows."""
    result = await session.execute(select(UserBadge).where(UserBadge.user_id == user_id))
    earned_at_by_code = {row.code: row.earned_at for row in result.scalars().all()}
    return [
        BadgeReadDict(
            code=badge.code,
            title=badge.title,
            description=badge.description,
            icon=badge.icon,
            earned=badge.code in earned_at_by_code,
            earned_at=earned_at_by_code.get(badge.code),
        )
        for badge in BADGE_REGISTRY.values()
    ]
