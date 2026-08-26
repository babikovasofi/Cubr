"""Random-opponent matchmaking DB layer — friends-hub plan, Этап C.

Queue rows live in `matchmaking_queue`, NOT process memory (skeptic HIGH#3
— see `app.models.matchmaking.MatchmakingQueue`'s docstring for why: a
deploy restart must not strand someone in "ищем соперника..." forever).

Pairing picks the OLDEST other still-waiting row (`room_id IS NULL`),
skipping anyone in a `chat_blocks` pair with the caller (either direction)
or already claimed by a concurrent pairing attempt, and hands room-creation
to whichever of the two users has the SMALLER uuid
(`app.services.friends.pair_key`, skeptic HIGH#4) — deterministic, so two
users who both happen to enqueue "into" each other converge on ONE room via
`app.services.duel.create_room`/`join_room`'s own partial-UNIQUE(user_id)
race machinery, never two half-open ones.

The actual claim on the CANDIDATE's row is an optimistic guarded UPDATE
(`WHERE room_id IS NULL`) done AFTER the room already exists, inside one
`session.begin_nested()` SAVEPOINT together with `create_room`/`join_room`
— if the claim loses the race (rowcount 0: someone else paired that
candidate microseconds earlier) OR either side turns out to already have
another active duel (`duel_service.DuelConflictError`), the WHOLE savepoint
rolls back (undoing the tentatively-created room too) and the caller tries
the next candidate. This is deliberately "create optimistically, roll back
on lost claim" rather than trying to reserve the candidate BEFORE creating
the room: `room_id` is the ONLY claim flag this table has (no separate
status column), and its value isn't known until the room exists.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import and_, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.chat import ChatBlock
from app.models.duel import DuelRoom
from app.models.matchmaking import MatchmakingQueue
from app.models.user import User
from app.services import duel as duel_service
from app.services import duel_token
from app.services.friends import now_utc, pair_key

# How many oldest-waiting candidates one enqueue call is willing to try
# before giving up and reporting "still waiting" — bounds the work of a
# single request; a candidate skipped here (blocked pair, lost claim race)
# is still in the queue for the NEXT caller/poll cycle to try.
_MAX_CANDIDATES_PER_ATTEMPT = 20


class MatchmakingLostRaceError(Exception):
    """Internal-only: the optimistic claim on a candidate's row lost a
    race (rowcount 0). Caught inside `_claim_pair`, never escapes this
    module.
    """


@dataclass(frozen=True)
class MatchResult:
    """A resolved pairing, ready to hand back to the caller. `enqueue`/
    `poll_once` return `None` (not this) while still waiting — see their
    docstrings.
    """

    room_id: uuid.UUID
    session_token: str


def _mint_token(user_id: uuid.UUID, room_id: uuid.UUID) -> str:
    settings = get_settings()
    return duel_token.sign(
        user_id, room_id, settings.DUEL_SIGN_SECRET, settings.DUEL_SESSION_TOKEN_TTL_SECONDS
    )


async def _blocked_pair(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    result = await session.execute(
        select(ChatBlock.blocker_id)
        .where(
            or_(
                and_(ChatBlock.blocker_id == a, ChatBlock.blocked_id == b),
                and_(ChatBlock.blocker_id == b, ChatBlock.blocked_id == a),
            )
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _claim_pair(
    session: AsyncSession, caller_id: uuid.UUID, candidate_id: uuid.UUID, now: datetime
) -> DuelRoom | None:
    """Try to pair `caller_id` with `candidate_id`. Returns the new room on
    success, `None` if the attempt lost a race of any kind (claim race,
    `duel_service.DuelConflictError` from either side already being in
    another active duel, or the structurally-shouldn't-happen
    `DuelRoomFullError`/`DuelNotFoundError` on the room we just made
    ourselves) — the caller moves on to the next candidate.
    """
    settings = get_settings()
    creator_id, joiner_id = pair_key(caller_id, candidate_id)
    try:
        async with session.begin_nested():
            room = await duel_service.create_room(session, creator_id)
            room = await duel_service.join_room(
                session,
                room.invite_token,
                joiner_id,
                settings.DUEL_INVITE_TTL_SECONDS,
                now=now,
            )
            claim_result = cast(
                "CursorResult[Any]",
                await session.execute(
                    update(MatchmakingQueue)
                    .where(
                        MatchmakingQueue.user_id == candidate_id, MatchmakingQueue.room_id.is_(None)
                    )
                    .values(room_id=room.id)
                ),
            )
            if claim_result.rowcount == 0:
                raise MatchmakingLostRaceError()
    except (
        MatchmakingLostRaceError,
        duel_service.DuelConflictError,
        duel_service.DuelRoomFullError,
        duel_service.DuelNotFoundError,
    ):
        return None
    return room


async def _attempt_pair(
    session: AsyncSession, caller_id: uuid.UUID, now: datetime
) -> tuple[DuelRoom, uuid.UUID] | tuple[None, None]:
    """Returns `(room, matched_candidate_id)` on success, `(None, None)`
    while still waiting. Deliberately does NOT call `chat_service.
    notify_user` itself — that must fire only AFTER the caller's
    transaction actually commits (mirrors `app.routers.chat.send_message`'s
    own commit-then-notify order); see `enqueue`.
    """
    result = await session.execute(
        select(MatchmakingQueue.user_id)
        .where(MatchmakingQueue.user_id != caller_id, MatchmakingQueue.room_id.is_(None))
        .order_by(MatchmakingQueue.created_at)
        .limit(_MAX_CANDIDATES_PER_ATTEMPT)
    )
    candidate_ids = [row[0] for row in result.all()]
    for candidate_id in candidate_ids:
        if await _blocked_pair(session, caller_id, candidate_id):
            continue
        room = await _claim_pair(session, caller_id, candidate_id, now)
        if room is not None:
            return room, candidate_id
    return None, None


async def enqueue(
    session: AsyncSession, caller: User, now: datetime | None = None
) -> tuple[MatchResult | None, uuid.UUID | None]:
    """Get-or-create the caller's own queue row, consuming an existing
    match if one is already sitting there (a previous pairing landed
    between the caller's last call and this one), else trying to pair
    RIGHT NOW against the current waiting pool. Returns `(result,
    matched_candidate_id)` — `result` is `None` (a normal, non-error "still
    waiting" outcome) if no pairing happens; `matched_candidate_id` is only
    ever non-`None` when THIS call just paired someone brand new (never on
    a consume-an-existing-match path) — the router wakes that candidate's
    own parked `GET /matchmaking/poll` via `chat_service.notify_user`
    AFTER committing, never before (a pre-commit notify could wake a
    separate DB connection into reading a row that isn't durably visible
    yet — a wasted, though harmless, round trip).

    409s (`duel_service.DuelConflictError`) if the caller already has
    ANOTHER active duel (unrelated to matchmaking) — checked only on the
    "not yet matched" path, never when merely consuming an already-set
    `room_id` (that room IS the caller's active duel by then; rejecting the
    consume call itself would be a bug, not a guard).
    """
    effective_now = now if now is not None else now_utc()
    row = await session.get(MatchmakingQueue, caller.id)

    if row is not None and row.room_id is not None:
        return await _consume(session, caller.id, row), None

    active = await duel_service.find_active_room(session, caller.id, now=effective_now)
    if active is not None:
        raise duel_service.DuelConflictError(active.id)

    if row is None:
        row = MatchmakingQueue(user_id=caller.id, created_at=effective_now)
        session.add(row)
        await session.flush()

    room, matched_candidate_id = await _attempt_pair(session, caller.id, effective_now)
    if room is None:
        return None, None

    await session.delete(row)
    await session.flush()
    result = MatchResult(room_id=room.id, session_token=_mint_token(caller.id, room.id))
    return result, matched_candidate_id


async def poll_once(session: AsyncSession, user_id: uuid.UUID) -> MatchResult | None:
    """One non-blocking check: has `user_id`'s queue row been matched by
    someone ELSE's `enqueue` since they last checked? Consumes (deletes)
    the row if so. Returns `None` if still waiting OR not queued at all —
    `GET /matchmaking/poll` (the router) treats both the same: keep
    waiting/long-polling. Does NOT attempt to pair the caller itself — only
    `enqueue` does that; a poll is purely a read-and-maybe-consume.
    """
    row = await session.get(MatchmakingQueue, user_id)
    if row is None or row.room_id is None:
        return None
    return await _consume(session, user_id, row)


async def _consume(
    session: AsyncSession, user_id: uuid.UUID, row: MatchmakingQueue
) -> MatchResult | None:
    room_id = row.room_id
    await session.delete(row)
    await session.flush()
    if room_id is None:
        return None
    return MatchResult(room_id=room_id, session_token=_mint_token(user_id, room_id))


async def cancel(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Leave the queue. No-op (not an error) if not queued. If the row was
    already matched (a pairing landed just before this call), the caller
    already has a live `DuelParticipant` in that room — created at PAIRING
    time by `_claim_pair`, not at consume time — so cancel does not, and
    cannot, "un-pair" them; it only clears the now-redundant queue row.
    """
    row = await session.get(MatchmakingQueue, user_id)
    if row is None:
        return
    await session.delete(row)
    await session.flush()
