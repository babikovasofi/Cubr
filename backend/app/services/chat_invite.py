"""Duel-invite-in-chat DB layer — friends-hub plan, Этап B. Split out of
`app.services.chat` on purpose (that module was already large) — everything
here concerns `app.models.duel_invite.DuelInvite`'s lifecycle, never plain
text messages.

Reuses `app.services.chat`'s conversation/seq/friendship plumbing
(`resolve_accepted_friendship`, `get_or_create_conversation`,
`allocate_seq_and_mark_read`) rather than duplicating it — an invite is a
`ChatMessage` like any other, just `kind="invite"` with `body=None` (see
`app.models.chat`'s docstring). `accept_invite` goes through the EXISTING
`app.services.duel.create_room`/`join_room` (skeptic MED/LOW: no second duel
surface) — never a bespoke room-creation path.

`effective_state` is the single source of "what does this invite look like
right now": a still-DB-`pending` row past its `expires_at` reports
`"expired"` on every read, but nothing WRITES that transition until a
MUTATING call (`accept_invite`/`decline_invite`/`cancel_invite`) actually
touches the row — see `app.models.duel_invite.DuelInvite`'s module
docstring, "mostly a DISPLAY-time derivation, not a background sweep". A
plain read (`GET /chat/poll`, `GET .../messages`) never persists anything.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.chat import ChatMessage
from app.models.duel import DuelRoom
from app.models.duel_invite import DuelInvite
from app.models.user import User
from app.schemas.chat import ChatMessageRead, DuelInviteRead
from app.services import chat as chat_service
from app.services import duel as duel_service
from app.services import duel_token
from app.services.friends import now_utc


class ChatInviteNotFoundError(Exception):
    """No such `invite_id`."""


class ChatInviteForbiddenError(Exception):
    """`invite_id` exists but the caller is not the party allowed to act on
    it (accept/decline: must be the invitee; cancel: must be the inviter).
    """


class ChatInviteNotActionableError(Exception):
    """The invite is no longer `pending` (already accepted/declined/
    canceled, or just discovered to be expired by THIS call) — a 404,
    idempotent: a repeat action, or a race lost to expiry, both land here
    every time, never a 500.
    """


# Re-exported so the router only needs to import THIS module for the whole
# invite error surface — `duel_service.DuelConflictError` (П11: caller
# already has another active duel) is the one exception `accept_invite` lets
# propagate as-is rather than wrapping (see that function's docstring).
DuelConflictError = duel_service.DuelConflictError


def _as_utc(value: datetime) -> datetime:
    """sqlite hands back naive datetimes after flush, Postgres hands back
    aware ones — mirrors `app.services.duel._as_utc` (same trap, same fix,
    deliberately not imported: that module's helper is private).
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def effective_state(invite: DuelInvite, now: datetime) -> str:
    """The DISPLAY-time state — see module docstring. Pure, no DB write."""
    if invite.state == "pending" and _as_utc(now) >= _as_utc(invite.expires_at):
        return "expired"
    return invite.state


def build_invite_read(invite: DuelInvite, caller_id: uuid.UUID, now: datetime) -> DuelInviteRead:
    """Build a caller-scoped `DuelInviteRead` — see that schema's docstring
    for why `state`/`can_*`/`session_token` all need this instead of a bare
    `.model_validate()`. Pure (no DB write) — callers that discover a
    pending-but-expired invite THROUGH a mutating action persist that
    separately (see `_expire_if_due` below); a plain read never does.
    """
    state = effective_state(invite, now)
    is_invitee = caller_id == invite.invitee_id
    is_inviter = caller_id == invite.inviter_id
    can_accept = state == "pending" and is_invitee
    can_decline = state == "pending" and is_invitee
    can_cancel = state == "pending" and is_inviter

    seconds_left = 0
    if state == "pending":
        remaining = (_as_utc(invite.expires_at) - _as_utc(now)).total_seconds()
        seconds_left = max(0, int(remaining))

    session_token = None
    if state == "accepted" and invite.room_id is not None and (is_inviter or is_invitee):
        settings = get_settings()
        session_token = duel_token.sign(
            caller_id,
            invite.room_id,
            settings.DUEL_SIGN_SECRET,
            settings.DUEL_SESSION_TOKEN_TTL_SECONDS,
        )

    return DuelInviteRead(
        id=invite.id,
        inviter_id=invite.inviter_id,
        invitee_id=invite.invitee_id,
        state=state,
        room_id=invite.room_id,
        expires_at=invite.expires_at,
        can_accept=can_accept,
        can_decline=can_decline,
        can_cancel=can_cancel,
        seconds_left=seconds_left,
        session_token=session_token,
    )


def build_message_read(
    message: ChatMessage, caller_id: uuid.UUID, now: datetime
) -> ChatMessageRead:
    """The ONE place a `ChatMessage` ORM row becomes a `ChatMessageRead` —
    every router call site (send/list/poll) goes through this instead of a
    bare `.model_validate(message)`, because that call raises on an
    `'invite'`-kind row: `DuelInviteRead` has no `from_attributes=True` of
    its own (deliberately — it needs caller-aware derivation, not a
    straight attribute copy), so pydantic cannot walk `message.invite` (a
    `DuelInvite` ORM instance) into it automatically. `message.invite` MUST
    already be eager-loaded (`selectinload`) by the caller for a
    `kind == "invite"` row — never lazily fetched here.
    """
    invite_read = None
    if message.kind == "invite" and message.invite is not None:
        invite_read = build_invite_read(message.invite, caller_id, now)
    return ChatMessageRead(
        id=message.id,
        conversation_id=message.conversation_id,
        seq=message.seq,
        sender_id=message.sender_id,
        body=message.body,
        kind=message.kind,
        invite=invite_read,
        created_at=message.created_at,
        deleted_at=message.deleted_at,
    )


async def send_invite(
    session: AsyncSession,
    caller: User,
    friendship_id: uuid.UUID,
    invite_ttl_seconds: int,
    notify_delay_seconds: int,
) -> ChatMessage:
    """Create a `kind="invite"` message + its `DuelInvite(state="pending")`
    row. **No duel room is created here** (skeptic HIGH#1) — `room_id` stays
    `NULL` until `accept_invite`. Raises `chat_service.ChatNotFriendsError`
    under the exact same conditions as a text `send_message` (unknown/
    foreign/still-pending `friendship_id`, or a removed-via-block
    friendship) — reuses `resolve_accepted_friendship` rather than
    re-deriving the rule.

    `notify_state="undeliverable"` from the INSERT itself (never `'pending'`
    even for one instant) — skeptic MED: `app.jobs.chat_notify`'s sweep only
    ever claims `notify_state = 'pending'` rows, so a terminal state set
    here keeps an invite out of the email sweep unconditionally, no
    special-case needed in the sweep itself.
    """
    friendship, other = await chat_service.resolve_accepted_friendship(
        session, caller.id, friendship_id
    )
    conversation = await chat_service.get_or_create_conversation(session, caller.id, other.id)

    now = now_utc()
    new_seq = await chat_service.allocate_seq_and_mark_read(session, conversation, caller.id, now)

    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=caller.id,
        seq=new_seq,
        body=None,
        kind="invite",
        created_at=now,
        notify_after=now + timedelta(seconds=notify_delay_seconds),
        notify_state="undeliverable",
    )
    session.add(message)
    await session.flush()

    invite = DuelInvite(
        message_id=message.id,
        inviter_id=caller.id,
        invitee_id=other.id,
        state="pending",
        created_at=now,
        expires_at=now + timedelta(seconds=invite_ttl_seconds),
    )
    session.add(invite)
    await session.flush()

    message.invite = invite
    return message


def _expire_if_due(invite: DuelInvite, now: datetime) -> bool:
    """If `invite` is DB-`pending` but past `expires_at`, persist the
    `expired` transition on the (already-loaded, in-session) object —
    caller flushes. Returns whether it expired just now.
    """
    if invite.state == "pending" and _as_utc(now) >= _as_utc(invite.expires_at):
        invite.state = "expired"
        invite.resolved_at = now
        return True
    return False


async def accept_invite(
    session: AsyncSession, caller: User, invite_id: uuid.UUID, now: datetime | None = None
) -> tuple[DuelInvite, DuelRoom, str]:
    """Only the INVITEE may accept. 404 (`ChatInviteNotFoundError`) unknown
    id; 403 (`ChatInviteForbiddenError`) caller isn't the invitee; 404
    (`ChatInviteNotActionableError`) already resolved OR just discovered
    expired (persisted here, then rejected — same call, idempotent on
    retry). `duel_service.DuelConflictError` (П11, either side already has
    another active duel) propagates AS-IS — the router maps it to the same
    409 shape `POST /duel/rooms`/`POST /duel/join/{token}` already use — and
    the invite is left untouched (still `pending`): the caller rolls back
    the whole transaction on that path, so neither the room this function
    tried to create nor `invite.state` are ever persisted.

    Goes through the EXISTING `duel_service.create_room` (inviter as
    `player_a`) then `duel_service.join_room` (invitee as `player_b`) — see
    module docstring. Mints the ACCEPTING caller's own fresh
    `session_token` immediately; the inviter's own token is minted lazily,
    next time THEY read this invite (`build_invite_read`).
    """
    effective_now = now if now is not None else now_utc()
    invite = await session.get(DuelInvite, invite_id)
    if invite is None:
        raise ChatInviteNotFoundError()
    if caller.id != invite.invitee_id:
        raise ChatInviteForbiddenError()
    if invite.state != "pending":
        raise ChatInviteNotActionableError()
    if _expire_if_due(invite, effective_now):
        await session.flush()
        raise ChatInviteNotActionableError()

    settings = get_settings()
    room = await duel_service.create_room(session, invite.inviter_id)
    room = await duel_service.join_room(
        session, room.invite_token, caller.id, settings.DUEL_INVITE_TTL_SECONDS, now=effective_now
    )

    invite.state = "accepted"
    invite.room_id = room.id
    invite.resolved_at = effective_now
    await session.flush()

    session_token = duel_token.sign(
        caller.id, room.id, settings.DUEL_SIGN_SECRET, settings.DUEL_SESSION_TOKEN_TTL_SECONDS
    )
    return invite, room, session_token


async def _resolve_non_accept(
    session: AsyncSession, invite: DuelInvite, target_state: str, now: datetime
) -> None:
    """Shared tail of `decline_invite`/`cancel_invite`.

    `invite.state == "accepted"` is the narrow race courtesy from
    `DuelInvite`'s docstring: a concurrent accept won already (the room
    exists) — honor the decline/cancel's INTENT by abandoning that room
    instead of surfacing "not pending" over what the human experienced as
    one clean click.
    """
    if invite.state == "accepted":
        if invite.room_id is not None:
            room = await session.get(DuelRoom, invite.room_id)
            if room is not None:
                await duel_service.abandon_room(session, room, now)
        invite.state = target_state
        invite.resolved_at = now
        await session.flush()
        return

    if invite.state != "pending":
        raise ChatInviteNotActionableError()
    if _expire_if_due(invite, now):
        await session.flush()
        raise ChatInviteNotActionableError()

    invite.state = target_state
    invite.resolved_at = now
    await session.flush()


async def decline_invite(
    session: AsyncSession, caller: User, invite_id: uuid.UUID, now: datetime | None = None
) -> DuelInvite:
    """Only the INVITEE may decline. Same 404/403/404 shape as
    `accept_invite`'s guards.
    """
    effective_now = now if now is not None else now_utc()
    invite = await session.get(DuelInvite, invite_id)
    if invite is None:
        raise ChatInviteNotFoundError()
    if caller.id != invite.invitee_id:
        raise ChatInviteForbiddenError()
    await _resolve_non_accept(session, invite, "declined", effective_now)
    return invite


async def cancel_invite(
    session: AsyncSession, caller: User, invite_id: uuid.UUID, now: datetime | None = None
) -> DuelInvite:
    """Only the INVITER may cancel. Same 404/403/404 shape as
    `accept_invite`'s guards.
    """
    effective_now = now if now is not None else now_utc()
    invite = await session.get(DuelInvite, invite_id)
    if invite is None:
        raise ChatInviteNotFoundError()
    if caller.id != invite.inviter_id:
        raise ChatInviteForbiddenError()
    await _resolve_non_accept(session, invite, "canceled", effective_now)
    return invite
