"""Friend-to-friend private chat DB layer — Этап A (переписка, без единого
письма) of `swarm-report/friend-chat-plan.md`.

Mirrors `app.services.friends`'s get-or-create-under-a-race shape
(`session.begin_nested()` + `IntegrityError` retry, not a TOCTOU pre-check)
and its `now_utc()`/`pair_key()` helpers (imported, not duplicated).

`seq` numbering (plan §3, "last_seq — не украшение"): handed out by
`UPDATE conversations SET last_seq = last_seq + 1 ... RETURNING last_seq`
INSIDE the same transaction that inserts the `ChatMessage` row, so two
concurrent sends into the same conversation serialize on that UPDATE and
get gapless, non-reordered numbers — a plain `BIGSERIAL` on `ChatMessage.seq`
cannot promise that (two inserts can commit in the opposite order their
sequence values were handed out).
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat import ChatBlock, ChatMessage, ChatRead, Conversation, UserPresence
from app.models.friendship import Friendship
from app.models.user import User
from app.services.friends import now_utc, pair_key
from app.services.moderation import NameRejection, check_message_text
from app.services.tournament import display_name_for


class ChatNotFriendsError(Exception):
    """Caller and the named `friendship_id` are not an accepted friendship
    — unknown id, someone else's row, a still-`pending` request, OR a
    friendship removed via block. ALL of these render the exact same 403 —
    see `app.routers.chat`: whether a block happened must never be
    observable from the response shape (plan §6).
    """


class ChatNotFoundError(Exception):
    """A `conversation_id`/`message_id` that does not name a row the
    caller participates in — unknown id and "someone else's" are
    deliberately the same 404 (mirrors `app.services.friends`).
    """


class ChatMessageRejectedError(Exception):
    """The message body tripped `moderation.check_message_text`."""

    def __init__(self, rejection: NameRejection) -> None:
        self.rejection = rejection
        super().__init__(rejection.code)


@dataclass
class ConversationEntry:
    id: uuid.UUID
    friendship_id: uuid.UUID | None
    display_name: str
    last_message_body: str | None
    # 'text' | 'invite' | None (no message yet). A `None` `last_message_body`
    # is ambiguous on its own (deleted text vs. a bodyless invite) — the
    # frontend preview needs this to tell them apart.
    last_message_kind: str | None
    last_message_at: datetime | None
    unread_count: int


async def _get_pair_conversation(
    session: AsyncSession, low: uuid.UUID, high: uuid.UUID
) -> Conversation | None:
    result = await session.execute(
        select(Conversation).where(
            Conversation.user_low_id == low, Conversation.user_high_id == high
        )
    )
    return result.scalar_one_or_none()


async def get_or_create_conversation(
    session: AsyncSession, user_a: uuid.UUID, user_b: uuid.UUID
) -> Conversation:
    """Get-or-create the one conversation for this unordered pair. Same
    race shape as `app.services.friends.send_request`'s friendship insert.
    """
    low, high = pair_key(user_a, user_b)
    existing = await _get_pair_conversation(session, low, high)
    if existing is not None:
        return existing
    try:
        async with session.begin_nested():
            conversation = Conversation(user_low_id=low, user_high_id=high)
            session.add(conversation)
            await session.flush()
    except IntegrityError:
        existing = await _get_pair_conversation(session, low, high)
        if existing is None:
            raise
        return existing
    return conversation


async def resolve_accepted_friendship(
    session: AsyncSession, caller_id: uuid.UUID, friendship_id: uuid.UUID
) -> tuple[Friendship, User]:
    """An ACCEPTED friendship the caller is part of. Raises
    `ChatNotFriendsError` for anything else — see that class's docstring
    for why unknown/not-yours/pending/blocked are all indistinguishable
    here.
    """
    result = await session.execute(
        select(Friendship)
        .options(selectinload(Friendship.user_low), selectinload(Friendship.user_high))
        .where(Friendship.id == friendship_id)
    )
    friendship = result.scalar_one_or_none()
    valid = (
        friendship is not None
        and friendship.status == "accepted"
        and caller_id in (friendship.user_low_id, friendship.user_high_id)
    )
    if not valid or friendship is None:
        raise ChatNotFriendsError()
    other = friendship.user_high if friendship.user_low_id == caller_id else friendship.user_low
    return friendship, other


async def allocate_seq_and_mark_read(
    session: AsyncSession, conversation: Conversation, caller_id: uuid.UUID, now: datetime
) -> int:
    """Hand out the next gapless `seq` for `conversation` (the UPDATE...
    RETURNING dance from the module docstring) AND advance the CALLER's own
    read cursor to it in the same transaction — shared by every message
    writer (`send_message` here, and `app.services.chat_invite.send_invite`)
    so a mixed text/invite conversation still numbers every row, of either
    kind, off ONE gapless counter.
    """
    result = await session.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id)
        .values(last_seq=Conversation.last_seq + 1, last_message_at=now)
        .returning(Conversation.last_seq)
    )
    new_seq = result.scalar_one()

    read = await session.get(ChatRead, (conversation.id, caller_id))
    if read is None:
        session.add(
            ChatRead(conversation_id=conversation.id, user_id=caller_id, last_read_seq=new_seq)
        )
    else:
        read.last_read_seq = new_seq
    return new_seq


async def send_message(
    session: AsyncSession,
    caller: User,
    friendship_id: uuid.UUID,
    body: str,
    notify_delay_seconds: int,
) -> tuple[ChatMessage, User]:
    """Send a message keyed by `friendship_id` (not `conversation_id` — the
    conversation may not exist yet for a first message). Returns
    `(message, other_user)`.

    Raises `ChatNotFriendsError` (403) or `ChatMessageRejectedError` (422,
    filter hit — the row is never written). The sender's OWN read cursor is
    advanced to the new `seq` in the SAME transaction (plan §4, "Получатель
    ответил": a reply is only possible after opening the conversation, so
    this keeps that invariant true unconditionally rather than depending on
    the frontend calling `POST .../read` first).
    """
    rejection = check_message_text(body)
    if rejection is not None:
        raise ChatMessageRejectedError(rejection)

    friendship, other = await resolve_accepted_friendship(session, caller.id, friendship_id)
    conversation = await get_or_create_conversation(session, caller.id, other.id)

    now = now_utc()
    new_seq = await allocate_seq_and_mark_read(session, conversation, caller.id, now)

    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=caller.id,
        seq=new_seq,
        body=body,
        kind="text",
        created_at=now,
        notify_after=now + timedelta(seconds=notify_delay_seconds),
    )
    session.add(message)

    await session.flush()
    return message, other


async def _participant_conversation(
    session: AsyncSession, caller_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None or caller_id not in (
        conversation.user_low_id,
        conversation.user_high_id,
    ):
        raise ChatNotFoundError()
    return conversation


async def list_messages(
    session: AsyncSession,
    caller_id: uuid.UUID,
    conversation_id: uuid.UUID,
    after_seq: int,
    limit: int,
) -> list[ChatMessage]:
    """Feed page: `seq > after_seq`, oldest first, capped at `limit`.

    Eager-loads `.invite` (`selectinload` — async SQLAlchemy forbids lazy
    loading) for every row: an `'invite'`-kind message's CURRENT lifecycle
    state must be re-read fresh on every call, never cached from an earlier
    poll — see `app.models.duel_invite.DuelInvite`'s module docstring.
    """
    await _participant_conversation(session, caller_id, conversation_id)
    result = await session.execute(
        select(ChatMessage)
        .options(selectinload(ChatMessage.invite))
        .where(ChatMessage.conversation_id == conversation_id, ChatMessage.seq > after_seq)
        .order_by(ChatMessage.seq)
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_read(
    session: AsyncSession, caller_id: uuid.UUID, conversation_id: uuid.UUID
) -> None:
    """Advance the caller's read cursor to the conversation's current tip."""
    conversation = await _participant_conversation(session, caller_id, conversation_id)
    read = await session.get(ChatRead, (conversation_id, caller_id))
    if read is None:
        session.add(
            ChatRead(
                conversation_id=conversation_id,
                user_id=caller_id,
                last_read_seq=conversation.last_seq,
            )
        )
    else:
        read.last_read_seq = conversation.last_seq
    await session.flush()


async def delete_message(
    session: AsyncSession, caller_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    """Delete-by-author: `body = NULL`, `deleted_at = now`. Row stays for
    numbering; the text is retained nowhere. `ChatNotFoundError` for
    anything else (unknown id or someone else's message).
    """
    message = await session.get(ChatMessage, message_id)
    if message is None or message.sender_id != caller_id:
        raise ChatNotFoundError()
    message.body = None
    message.deleted_at = now_utc()
    await session.flush()


async def list_conversations(session: AsyncSession, user_id: uuid.UUID) -> list[ConversationEntry]:
    """`GET /chat/conversations`: every conversation the caller is part of,
    newest-active first, with unread count and last-message preview.
    """
    result = await session.execute(
        select(Conversation)
        .options(selectinload(Conversation.user_low), selectinload(Conversation.user_high))
        .where(or_(Conversation.user_low_id == user_id, Conversation.user_high_id == user_id))
        .order_by(Conversation.last_message_at.desc())
    )
    conversations = result.scalars().all()
    if not conversations:
        return []

    conv_ids = [c.id for c in conversations]

    unread_stmt = (
        select(ChatMessage.conversation_id, func.count(ChatMessage.id))
        .outerjoin(
            ChatRead,
            (ChatRead.conversation_id == ChatMessage.conversation_id)
            & (ChatRead.user_id == user_id),
        )
        .where(
            ChatMessage.conversation_id.in_(conv_ids),
            ChatMessage.sender_id != user_id,
            ChatMessage.deleted_at.is_(None),
            ChatMessage.seq > func.coalesce(ChatRead.last_read_seq, 0),
        )
        .group_by(ChatMessage.conversation_id)
    )
    unread_result = await session.execute(unread_stmt)
    unread_map: dict[uuid.UUID, int] = {row[0]: row[1] for row in unread_result.all()}

    pairs = [(pair_key(c.user_low_id, c.user_high_id)) for c in conversations]
    friendships_result = await session.execute(
        select(Friendship).where(
            or_(
                *[
                    (Friendship.user_low_id == low) & (Friendship.user_high_id == high)
                    for low, high in pairs
                ]
            ),
            Friendship.status == "accepted",
        )
    )
    friendship_map: dict[tuple[uuid.UUID, uuid.UUID], uuid.UUID] = {
        (f.user_low_id, f.user_high_id): f.id for f in friendships_result.scalars().all()
    }

    entries: list[ConversationEntry] = []
    for conversation in conversations:
        other = (
            conversation.user_high if conversation.user_low_id == user_id else conversation.user_low
        )
        last_message: ChatMessage | None = None
        if conversation.last_message_at is not None:
            last_result = await session.execute(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation.id)
                .order_by(ChatMessage.seq.desc())
                .limit(1)
            )
            last_message = last_result.scalar_one_or_none()
        low, high = pair_key(conversation.user_low_id, conversation.user_high_id)
        entries.append(
            ConversationEntry(
                id=conversation.id,
                friendship_id=friendship_map.get((low, high)),
                display_name=display_name_for(other.handle),
                last_message_body=last_message.body if last_message is not None else None,
                last_message_kind=last_message.kind if last_message is not None else None,
                last_message_at=conversation.last_message_at,
                unread_count=unread_map.get(conversation.id, 0),
            )
        )
    return entries


async def touch_presence(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, write_interval_seconds: int
) -> None:
    """Bump `user_presence.last_seen_at` — throttled: only writes if the
    existing row is older than `write_interval_seconds` (or missing).
    """
    presence = await session.get(UserPresence, user_id)
    if presence is None:
        session.add(UserPresence(user_id=user_id, last_seen_at=now))
        await session.flush()
        return
    # sqlite (tests) reads `DateTime(timezone=True)` columns back as
    # naive — Postgres does not. Normalize to UTC before subtracting so
    # this works identically on both.
    last_seen_at = presence.last_seen_at
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    if (now - last_seen_at).total_seconds() >= write_interval_seconds:
        presence.last_seen_at = now
        await session.flush()


async def block_user(session: AsyncSession, caller: User, friendship_id: uuid.UUID) -> User:
    """Block = remove the friendship + insert a `ChatBlock` row, in that
    order, atomically — "blocked but still friends" must never be
    observable (plan §6). Also resolves every still-`pending` message of
    this pair to `'blocked'` (mirrors `friends.remove_friend`'s
    `'unfriended'` sweep — see `app.services.friends.remove_friend`).
    Returns the blocked user.
    """
    friendship, other = await resolve_accepted_friendship(session, caller.id, friendship_id)
    await session.delete(friendship)
    await session.flush()

    existing_block = await session.get(ChatBlock, (caller.id, other.id))
    if existing_block is None:
        session.add(ChatBlock(blocker_id=caller.id, blocked_id=other.id))

    conversation = await _get_pair_conversation(session, *pair_key(caller.id, other.id))
    if conversation is not None:
        await session.execute(
            update(ChatMessage)
            .where(
                ChatMessage.conversation_id == conversation.id,
                ChatMessage.notify_state == "pending",
            )
            .values(notify_state="blocked", notify_resolved_at=now_utc())
        )
    await session.flush()
    return other


async def unblock_user(session: AsyncSession, caller_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
    """`ChatNotFoundError` if no such block exists — mirrors
    `app.services.friends`'s "unknown vs. not-yours is the same 404" shape
    (there's nothing to distinguish here: only the blocker can ever look up
    their own block by the blocked user's id).
    """
    block = await session.get(ChatBlock, (caller_id, blocked_id))
    if block is None:
        raise ChatNotFoundError()
    await session.delete(block)
    await session.flush()


async def is_blocked(session: AsyncSession, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> bool:
    block = await session.get(ChatBlock, (blocker_id, blocked_id))
    return block is not None


# ---------------------------------------------------------------------------
# Long-poll wakeup — PURE latency optimization (plan §2). One
# `asyncio.Event` per user in process memory. If the registry is empty
# (fresh process, or the entry was never created) or a signal is lost, the
# worst case is `GET /chat/poll` returning empty and the CALLER's own
# `asyncio.wait_for` timing out after `CHAT_POLL_TIMEOUT_SECONDS` — the
# message is never actually lost, it is already committed to the DB and the
# next poll cycle (this one, on timeout, or the client's next request) reads
# it. NEVER the delivery mechanism itself — see `app.routers.chat` module
# docstring.
# ---------------------------------------------------------------------------

_poll_events: dict[uuid.UUID, asyncio.Event] = {}


def get_poll_event(user_id: uuid.UUID) -> asyncio.Event:
    """The CURRENT waitable event for `user_id` — creates one if absent."""
    event = _poll_events.get(user_id)
    if event is None:
        event = asyncio.Event()
        _poll_events[user_id] = event
    return event


def notify_user(user_id: uuid.UUID) -> None:
    """Wake any long-poll(s) currently parked for `user_id`, then install a
    fresh (unset) `Event` for the next round — an `Event` is single-shot
    (`.set()` is sticky), so it must be replaced, not merely `.clear()`-ed,
    or the NEXT poll to call `get_poll_event` would see it already set and
    return without ever actually waiting.
    """
    event = _poll_events.get(user_id)
    if event is not None:
        event.set()
    _poll_events[user_id] = asyncio.Event()
