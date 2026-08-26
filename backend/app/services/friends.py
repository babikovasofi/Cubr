"""Friend request / friendship DB layer.

Mirrors `app.services.duel`'s get-or-create-under-a-race shape: every insert
that could collide with an existing row runs inside `session.begin_nested()`
and, on `IntegrityError`, re-SELECTs the row that actually exists instead of
a TOCTOU pre-check (see `send_request`).

Enumeration note (Decision #1 in the plan): `handle` is a field the user
themself makes public and it already appears on the tournament/daily
boards — "this handle exists" is not new information, so the 404/409/409
outcomes below stay observably different. The ONLY mitigation kept against
mass probing is a per-CALLING-USER rate limit
(`app.services.ratelimit.user_rate_limit`, wired on the router), not
response-shape unification.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.friendship import Friendship
from app.models.user import User
from app.services.tournament import display_name_for


def now_utc() -> datetime:
    """Centralized clock — mirrors `app.services.duel.now_utc`."""
    return datetime.now(timezone.utc)


class FriendNotFoundError(Exception):
    """No such handle, or a `friendship_id` that does not name a row the
    caller is allowed to act on (unknown id and "someone else's row" are
    DELIBERATELY the same error — see `accept`/`delete_request`/
    `remove_friend`)."""


class FriendSelfError(Exception):
    """A friend request targeting the caller's own handle."""


class FriendHandleRequiredError(Exception):
    """The caller has no `handle` of their own set yet."""


class FriendConflictError(Exception):
    """An equivalent row already exists. `reason` is `"PENDING"` (a request
    between this pair is already outstanding) or `"FRIENDS"` (the pair is
    already friends)."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(f"Friendship conflict: {reason}")


@dataclass
class FriendEntry:
    friendship_id: uuid.UUID
    display_name: str
    since: datetime
    # friends-hub plan, Этап A — presence dot. `True` iff the OTHER party's
    # `user_presence.last_seen_at` (bumped by `GET /chat/poll`, see
    # `app.models.chat.UserPresence`) is no older than
    # `settings.CHAT_PRESENCE_ONLINE_WINDOW_SECONDS` as of `list_friends`'s
    # own `now` — see that function for the LEFT JOIN. `False` (never
    # `None`) when the friend has no presence row at all (never polled).
    is_online: bool


@dataclass
class FriendRequestEntry:
    friendship_id: uuid.UUID
    display_name: str
    created_at: datetime


def pair_key(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Canonical `(user_low_id, user_high_id)` ordering for a pair — see
    `app.models.friendship.Friendship`'s docstring for why `sorted()` on
    `uuid.UUID` matches the DB's own `<` ordering on both Postgres and
    sqlite.
    """
    low, high = sorted((a, b))
    return low, high


async def _get_pair(session: AsyncSession, low: uuid.UUID, high: uuid.UUID) -> Friendship | None:
    result = await session.execute(
        select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high)
    )
    return result.scalar_one_or_none()


async def send_request(
    session: AsyncSession, requester: User, handle: str
) -> tuple[Friendship, User]:
    """Create (or auto-accept) a friend request from `requester` to whoever
    holds `handle` (case-insensitive). Returns `(friendship, other_user)` —
    `other_user` is always `target` (the person looked up by `handle`),
    handed back explicitly so the ROUTER never has to touch
    `Friendship.user_low`/`user_high` on a row that wasn't loaded with
    `selectinload` (async SQLAlchemy forbids implicit lazy loading, and a
    freshly-`add()`ed or `session.get()`-fetched row has neither relationship
    populated).

    Raises `FriendNotFoundError` (no active user has that handle),
    `FriendSelfError` (targets the requester's own handle),
    `FriendHandleRequiredError` (requester has no handle of their own —
    "add by handle" requires having one), or `FriendConflictError` if the
    pair already has a row: `"PENDING"` if the SAME requester already has an
    outstanding request to this same target, `"FRIENDS"` if the pair is
    already friends.

    A REVERSE request — the target already requested the caller — is NOT a
    conflict: it is auto-accepted (both sides have now expressed consent;
    forcing a second explicit "accept" click for no reason would just be
    friction). This is detected by losing the `begin_nested()` insert race
    against the existing pending row and finding `requested_by_id` is the
    OTHER party, not re-checked via a separate pre-query (TOCTOU).
    """
    if not requester.handle:
        raise FriendHandleRequiredError()

    normalized = handle.strip().lower()
    target_result = await session.execute(select(User).where(func.lower(User.handle) == normalized))
    # `.unique()`: `User.oauth_accounts` is `lazy="joined"` — any direct
    # `select(User)` needs this before consuming rows, same as
    # `tests/test_profile_names.py`'s pattern.
    target = target_result.unique().scalar_one_or_none()
    # `User.is_active` is checked on the INSTANCE (not in the WHERE clause):
    # fastapi-users' base table declares it `if TYPE_CHECKING: is_active: bool`
    # for type-checker purposes, which shadows the real mapped column at the
    # CLASS level for mypy — every other read of it in this codebase
    # (`app.services.ws_auth`, `app.routers.auth`) is likewise instance-side.
    if target is None or not target.is_active:
        raise FriendNotFoundError()
    if target.id == requester.id:
        raise FriendSelfError()

    # Chat plan §6: a block in EITHER direction stops a fresh request —
    # SAME 404 as an unknown handle, so the block itself never leaks (a
    # distinct error here would be a signal "this handle exists AND has
    # blocked you", which is exactly what must not be observable).
    # Imported locally to avoid a module-level cycle (app.services.chat
    # imports THIS module for now_utc/pair_key).
    from app.models.chat import ChatBlock

    block_result = await session.execute(
        select(ChatBlock).where(
            or_(
                (ChatBlock.blocker_id == target.id) & (ChatBlock.blocked_id == requester.id),
                (ChatBlock.blocker_id == requester.id) & (ChatBlock.blocked_id == target.id),
            )
        )
    )
    if block_result.scalar_one_or_none() is not None:
        raise FriendNotFoundError()

    low, high = pair_key(requester.id, target.id)
    try:
        async with session.begin_nested():
            friendship = Friendship(
                user_low_id=low,
                user_high_id=high,
                requested_by_id=requester.id,
                status="pending",
            )
            session.add(friendship)
            await session.flush()
    except IntegrityError as exc:
        existing = await _get_pair(session, low, high)
        if existing is None:
            # The IntegrityError wasn't the pair-UNIQUE race after all
            # (e.g. an astronomically unlikely id collision) — surface it.
            raise
        if existing.status == "accepted":
            raise FriendConflictError("FRIENDS") from exc
        if existing.requested_by_id == requester.id:
            raise FriendConflictError("PENDING") from exc
        # Reverse request: the OTHER party already asked — auto-accept.
        existing.status = "accepted"
        existing.responded_at = now_utc()
        await session.flush()
        return existing, target
    return friendship, target


async def accept(
    session: AsyncSession, caller: User, friendship_id: uuid.UUID
) -> tuple[Friendship, User]:
    """Accept an INCOMING pending request. Returns `(friendship, other_user)`
    — see `send_request`'s docstring for why the caller (the router) gets
    the other party handed back explicitly rather than reading
    `friendship.user_low`/`user_high` (this row is `session.get()`-fetched,
    not `selectinload`-ed, so those relationships are never populated).

    Any mismatch — unknown id, a request addressed to someone else, the
    caller's own outgoing request, or a request that is no longer `pending`
    (already accepted/double accept) — is the SAME `FriendNotFoundError`
    (404): by `friendship_id` alone there is no way to distinguish "doesn't
    exist" from "not yours", and leaking that distinction would let a
    caller probe row existence they have no business seeing.
    """
    friendship = await session.get(Friendship, friendship_id)
    valid = (
        friendship is not None
        and friendship.status == "pending"
        and caller.id in (friendship.user_low_id, friendship.user_high_id)
        and friendship.requested_by_id != caller.id
    )
    if not valid or friendship is None:
        raise FriendNotFoundError()
    friendship.status = "accepted"
    friendship.responded_at = now_utc()
    await session.flush()
    other_id = (
        friendship.user_high_id if friendship.user_low_id == caller.id else friendship.user_low_id
    )
    other = await session.get(User, other_id)
    assert other is not None  # FK (ON DELETE CASCADE) guarantees this row exists
    return friendship, other


async def delete_request(session: AsyncSession, caller: User, friendship_id: uuid.UUID) -> None:
    """Decline an incoming request OR cancel an outgoing one — same
    operation either way (delete the still-`pending` row); the caller just
    needs to be a member of the pair. `FriendNotFoundError` for anything
    else (unknown id, someone else's row, or a row that is already
    `accepted` — removing a FRIEND goes through `remove_friend` instead).
    """
    friendship = await session.get(Friendship, friendship_id)
    valid = (
        friendship is not None
        and friendship.status == "pending"
        and caller.id in (friendship.user_low_id, friendship.user_high_id)
    )
    if not valid or friendship is None:
        raise FriendNotFoundError()
    await session.delete(friendship)
    await session.flush()


async def remove_friend(session: AsyncSession, caller: User, friendship_id: uuid.UUID) -> None:
    """Remove an existing friendship. `FriendNotFoundError` for anything
    else (unknown id, someone else's row, or a row that is still
    `pending`).

    Also resolves the pair's chat, if one exists (friend-chat plan §4,
    "Дружба удалена"): every still-`pending` `ChatMessage` of this pair is
    flipped to `notify_state = 'unfriended'` in the SAME transaction, so no
    email can go out for it even if the Этап B sweep runs a second later.
    The conversation and its messages are NOT deleted — see
    `app.models.chat` / the plan's §5 for why history survives an unfriend.
    """
    friendship = await session.get(Friendship, friendship_id)
    valid = (
        friendship is not None
        and friendship.status == "accepted"
        and caller.id in (friendship.user_low_id, friendship.user_high_id)
    )
    if not valid or friendship is None:
        raise FriendNotFoundError()

    # Imported locally to avoid a module-level cycle: app.services.chat
    # imports THIS module (for now_utc/pair_key).
    from app.models.chat import ChatMessage, Conversation

    low, high = pair_key(friendship.user_low_id, friendship.user_high_id)
    conversation_result = await session.execute(
        select(Conversation).where(
            Conversation.user_low_id == low, Conversation.user_high_id == high
        )
    )
    conversation = conversation_result.scalar_one_or_none()
    if conversation is not None:
        await session.execute(
            update(ChatMessage)
            .where(
                ChatMessage.conversation_id == conversation.id,
                ChatMessage.notify_state == "pending",
            )
            .values(notify_state="unfriended", notify_resolved_at=now_utc())
        )

    await session.delete(friendship)
    await session.flush()


def _other(friendship: Friendship, user_id: uuid.UUID) -> User:
    return friendship.user_high if friendship.user_low_id == user_id else friendship.user_low


def _as_utc(value: datetime) -> datetime:
    """sqlite hands back naive datetimes after flush, Postgres hands back
    aware ones — mirrors `app.services.duel._as_utc` (same trap, same fix).
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def list_friends(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    online_window_seconds: int,
    now: datetime | None = None,
) -> list[FriendEntry]:
    """Accepted friendships the caller is part of, newest-accepted first.

    friends-hub plan, Этап A: a LEFT JOIN onto `user_presence` per friend —
    `is_online` is `True` iff a presence row exists AND its `last_seen_at`
    is within `online_window_seconds` of `now`. Deliberately a Python-side
    LEFT JOIN (fetch both, join by id in memory) rather than a SQL JOIN on
    `Friendship` (whose `user_low`/`user_high` are already `selectinload`-ed
    separately above) — one extra query for at most `len(rows)` presence
    rows, simpler than juggling two different "other side" columns in one
    JOIN condition.
    """
    effective_now = now if now is not None else now_utc()
    result = await session.execute(
        select(Friendship)
        .options(selectinload(Friendship.user_low), selectinload(Friendship.user_high))
        .where(
            Friendship.status == "accepted",
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id),
        )
        .order_by(Friendship.responded_at.desc())
    )
    rows = result.scalars().all()

    # Imported locally to avoid a module-level cycle (app.services.chat
    # imports THIS module for now_utc/pair_key).
    from app.models.chat import UserPresence

    other_ids = [_other(row, user_id).id for row in rows]
    last_seen_map: dict[uuid.UUID, datetime] = {}
    if other_ids:
        presence_result = await session.execute(
            select(UserPresence).where(UserPresence.user_id.in_(other_ids))
        )
        last_seen_map = {p.user_id: p.last_seen_at for p in presence_result.scalars().all()}

    entries = []
    for row in rows:
        other = _other(row, user_id)
        last_seen = last_seen_map.get(other.id)
        is_online = last_seen is not None and (
            effective_now - _as_utc(last_seen) <= timedelta(seconds=online_window_seconds)
        )
        entries.append(
            FriendEntry(
                friendship_id=row.id,
                display_name=display_name_for(other.handle),
                since=row.responded_at if row.responded_at is not None else row.created_at,
                is_online=is_online,
            )
        )
    return entries


async def list_incoming(session: AsyncSession, user_id: uuid.UUID) -> list[FriendRequestEntry]:
    """Pending requests addressed TO the caller (someone else requested)."""
    result = await session.execute(
        select(Friendship)
        .options(selectinload(Friendship.user_low), selectinload(Friendship.user_high))
        .where(
            Friendship.status == "pending",
            Friendship.requested_by_id != user_id,
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id),
        )
        .order_by(Friendship.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        FriendRequestEntry(
            friendship_id=row.id,
            display_name=display_name_for(_other(row, user_id).handle),
            created_at=row.created_at,
        )
        for row in rows
    ]


async def list_outgoing(session: AsyncSession, user_id: uuid.UUID) -> list[FriendRequestEntry]:
    """Pending requests the caller SENT (still awaiting the other side)."""
    result = await session.execute(
        select(Friendship)
        .options(selectinload(Friendship.user_low), selectinload(Friendship.user_high))
        .where(Friendship.status == "pending", Friendship.requested_by_id == user_id)
        .order_by(Friendship.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        FriendRequestEntry(
            friendship_id=row.id,
            display_name=display_name_for(_other(row, user_id).handle),
            created_at=row.created_at,
        )
        for row in rows
    ]
