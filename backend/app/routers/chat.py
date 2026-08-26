"""Friend-to-friend private chat routes — Этап A ("переписка, без единого
письма") of `swarm-report/friend-chat-plan.md`. Every route requires an
authenticated active user (anon -> 401) — see each endpoint.

`GET /chat/poll` is the one endpoint in this router that does NOT use
`Depends(get_session)` or `Depends(current_active_user)` — both transitively
hold a pooled DB connection open for the whole request via FastAPI's
dependency-injection lifetime, which is fatal here: this endpoint parks for
up to `CHAT_POLL_TIMEOUT_SECONDS` (25s) waiting for new messages, and with
the default pool (5 + 10 overflow) fifteen concurrently open browser tabs
would exhaust it and take down the ENTIRE API — login, dueling, everything
(plan §2/§9, "Пул соединений съеден припаркованными опросами"). It instead
authenticates off the raw cookie and opens/closes its own short-lived
`async_session_maker()` sessions around each DB phase, closing BEFORE the
`asyncio.wait_for(...)` wait — mirrors `app.routers.duel`'s `_on_activate`/
`_on_finalize`/`_on_abandon` callbacks, which open their own sessions
outside any request for the analogous reason (no request-scoped session to
borrow from an `asyncio.Task`).

Block returns the SAME 403, byte-for-byte, as "not friends" — see
`app.services.chat.ChatNotFriendsError`'s docstring: a block always removes
the friendship first, so by the time a blocked person tries to message,
there is no accepted friendship row left to distinguish "blocked" from
"never were friends" or "request still pending". This is deliberate (plan
§6): a distinguishable error would let a blocked person confirm the block.
"""

import asyncio
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import get_session
from app.models import OAuthAccount, User
from app.models.chat import ChatMessage, Conversation
from app.schemas.chat import (
    ChatInviteCreate,
    ChatMessageCreate,
    ChatMessageRead,
    ChatPollRead,
    ConversationRead,
    DuelInviteActionRead,
)
from app.services import chat as chat_service
from app.services import chat_invite as chat_invite_service
from app.services import duel as duel_service
from app.services import ratelimit
from app.services.auth import UserManager, current_active_user, get_jwt_strategy, password_helper
from app.services.friends import now_utc

logger = logging.getLogger("cubr.chat")

settings = get_settings()

router = APIRouter(prefix="/chat", tags=["chat"])

_NOT_FRIENDS_DETAIL = {"code": "CHAT_NOT_FRIENDS", "reason": "Not friends."}
_ZERO_UUID = uuid.UUID(int=0)
# One page of a poll response — generous relative to CHAT_POLL_RATE_LIMIT
# (a client cannot call often enough to need more per call).
_POLL_PAGE_LIMIT = 200

_send_user_limit = Depends(
    ratelimit.user_rate_limit(settings.CHAT_SEND_RATE_LIMIT, scope="chat-send")
)
_send_conv_limit = Depends(
    ratelimit.user_conversation_rate_limit(
        settings.CHAT_SEND_PER_CONVERSATION_LIMIT,
        scope="chat-send-conv",
        path_param="friendship_id",
    )
)
_send_daily_limit = Depends(
    ratelimit.user_rate_limit(settings.CHAT_SEND_DAILY_LIMIT, scope="chat-send-daily")
)
_invite_user_limit = Depends(
    ratelimit.user_rate_limit(settings.CHAT_INVITE_RATE_LIMIT, scope="chat-invite")
)


# ---------------------------------------------------------------------------
# Cursor codec for GET /chat/poll — opaque to the client: "<created_at
# isoformat>|<message id>", ordered lexicographically the same as the query
# below orders rows (timestamp, then id as a tiebreak for same-timestamp
# messages across different conversations).
# ---------------------------------------------------------------------------


def _encode_cursor(created_at: datetime, message_id: uuid.UUID) -> str:
    return f"{created_at.isoformat()}|{message_id}"


def _decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID]:
    if not cursor:
        # No cursor: start watching from now — poll returns backlog only
        # via GET /chat/conversations/{id}/messages, never via /poll.
        return now_utc(), _ZERO_UUID
    try:
        ts_part, id_part = cursor.rsplit("|", 1)
        return datetime.fromisoformat(ts_part), uuid.UUID(id_part)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor"
        ) from exc


async def _authenticate_short(request: Request) -> User:
    """Cookie-JWT auth for `GET /chat/poll` ONLY — opens its own session,
    closes it before returning. Mirrors `app.services.ws_auth.get_ws_user`
    (same JWT strategy / cookie name) but for an HTTP `Request` instead of a
    `WebSocket`, and raises 401 instead of returning `None` (there is no
    socket to close-with-a-code here). NOT reused elsewhere in this router —
    every other route can afford the ordinary `Depends(current_active_user)`.
    """
    token = request.cookies.get(settings.COOKIE_NAME)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    from app.db import async_session_maker

    async with async_session_maker() as session:
        user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = SQLAlchemyUserDatabase(
            session, User, OAuthAccount
        )
        user_manager = UserManager(user_db, password_helper)
        user = await get_jwt_strategy().read_token(token, user_manager)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


async def _poll_query(
    session: AsyncSession, user_id: uuid.UUID, cursor_ts: datetime, cursor_id: uuid.UUID
) -> list[ChatMessage]:
    result = await session.execute(
        select(ChatMessage)
        .options(selectinload(ChatMessage.invite))
        .join(Conversation, Conversation.id == ChatMessage.conversation_id)
        .where(
            or_(Conversation.user_low_id == user_id, Conversation.user_high_id == user_id),
            or_(
                ChatMessage.created_at > cursor_ts,
                (ChatMessage.created_at == cursor_ts) & (ChatMessage.id > cursor_id),
            ),
        )
        .order_by(ChatMessage.created_at, ChatMessage.id)
        .limit(_POLL_PAGE_LIMIT)
    )
    return list(result.scalars().all())


async def _poll_phase(
    user_id: uuid.UUID, cursor_ts: datetime, cursor_id: uuid.UUID
) -> list[ChatMessage]:
    """One short DB phase: bump presence, read new messages, commit, close.
    NEVER held open across the `asyncio.wait_for` wait — see module
    docstring.
    """
    from app.db import async_session_maker

    async with async_session_maker() as session:
        await chat_service.touch_presence(
            session, user_id, now_utc(), settings.CHAT_PRESENCE_WRITE_INTERVAL_SECONDS
        )
        messages = await _poll_query(session, user_id, cursor_ts, cursor_id)
        await session.commit()
        return messages


@router.post(
    "/conversations/{friendship_id}/messages",
    response_model=ChatMessageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_send_user_limit, _send_conv_limit, _send_daily_limit],
)
async def send_message(
    friendship_id: uuid.UUID,
    body: ChatMessageCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> ChatMessageRead:
    """403 `CHAT_NOT_FRIENDS` if `friendship_id` is unknown, not the
    caller's, still `pending`, or the pair was blocked (see module
    docstring). 422 `MESSAGE_NOT_ALLOWED` if the filter trips — the row is
    never written.
    """
    # Captured BEFORE any `session.rollback()` below: a rollback expires
    # every ORM object bound to this session (SQLAlchemy default), and a
    # subsequent attribute read on an expired object triggers a lazy
    # reload — which async SQLAlchemy cannot do synchronously and raises
    # `MissingGreenlet` instead. `user` is loaded by THIS SAME session
    # (`Depends(current_active_user)` -> `Depends(get_session)`), so its
    # `.id` must be read while still fresh.
    sender_id = user.id
    try:
        message, other = await chat_service.send_message(
            session, user, friendship_id, body.body, settings.CHAT_NOTIFY_DELAY_SECONDS
        )
    except chat_service.ChatNotFriendsError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_NOT_FRIENDS_DETAIL
        ) from exc
    except chat_service.ChatMessageRejectedError as exc:
        await session.rollback()
        logger.info(
            "chat_filter_hit", extra={"sender_id": str(sender_id), "code": exc.rejection.code}
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.rejection.code, "reason": exc.rejection.reason},
        ) from exc
    await session.commit()
    logger.info(
        "chat_message_sent",
        extra={
            "sender_id": str(sender_id),
            "conversation_id": str(message.conversation_id),
            "seq": message.seq,
            "len_body": len(body.body),
        },
    )
    chat_service.notify_user(other.id)
    return chat_invite_service.build_message_read(message, sender_id, now_utc())


@router.get("/conversations", response_model=list[ConversationRead])
async def list_conversations(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[ConversationRead]:
    entries = await chat_service.list_conversations(session, user.id)
    return [ConversationRead.model_validate(entry) for entry in entries]


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageRead])
async def list_messages(
    conversation_id: uuid.UUID,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[ChatMessageRead]:
    try:
        messages = await chat_service.list_messages(
            session, user.id, conversation_id, after_seq, limit
        )
    except chat_service.ChatNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        ) from exc
    now = now_utc()
    return [chat_invite_service.build_message_read(m, user.id, now) for m in messages]


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    conversation_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await chat_service.mark_read(session, user.id, conversation_id)
    except chat_service.ChatNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        ) from exc
    await session.commit()


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await chat_service.delete_message(session, user.id, message_id)
    except chat_service.ChatNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        ) from exc
    await session.commit()


@router.post("/blocks/{friendship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def block(
    friendship_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        other = await chat_service.block_user(session, user, friendship_id)
    except chat_service.ChatNotFriendsError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_NOT_FRIENDS_DETAIL
        ) from exc
    await session.commit()
    logger.info("chat_blocked", extra={"blocker_id": str(user.id), "blocked_id": str(other.id)})


@router.delete("/blocks/{user_ref}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock(
    user_ref: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await chat_service.unblock_user(session, user.id, user_ref)
    except chat_service.ChatNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Block not found"
        ) from exc
    await session.commit()


@router.get("/poll", response_model=ChatPollRead)
async def poll(request: Request, cursor: str | None = None) -> ChatPollRead:
    """Long-poll: returns new messages across every conversation the caller
    is part of, since `cursor`. See module docstring for why this route
    does NOT use `Depends(get_session)`/`Depends(current_active_user)`.
    """
    user = await _authenticate_short(request)
    await ratelimit.enforce_user_rate_limit(settings.CHAT_POLL_RATE_LIMIT, "chat-poll", user.id)

    cursor_ts, cursor_id = _decode_cursor(cursor)

    event = chat_service.get_poll_event(user.id)
    messages = await _poll_phase(user.id, cursor_ts, cursor_id)
    if not messages:
        try:
            await asyncio.wait_for(event.wait(), timeout=settings.CHAT_POLL_TIMEOUT_SECONDS)
        except TimeoutError:
            pass
        messages = await _poll_phase(user.id, cursor_ts, cursor_id)

    if messages:
        last = messages[-1]
        new_cursor = _encode_cursor(last.created_at, last.id)
    else:
        new_cursor = _encode_cursor(cursor_ts, cursor_id)

    poll_now = now_utc()
    return ChatPollRead(
        cursor=new_cursor,
        messages=[chat_invite_service.build_message_read(m, user.id, poll_now) for m in messages],
    )


# ---------------------------------------------------------------------------
# Этап B — duel invite lifecycle (see app.services.chat_invite)
# ---------------------------------------------------------------------------

_INVITE_DETAIL = {"code": "CHAT_INVITE_NOT_FOUND", "reason": "Invite not found."}
_INVITE_FORBIDDEN_DETAIL = {
    "code": "CHAT_INVITE_FORBIDDEN",
    "reason": "Not your invite to act on.",
}
_INVITE_NOT_ACTIONABLE_DETAIL = {
    "code": "CHAT_INVITE_NOT_ACTIONABLE",
    "reason": "Invite is no longer pending.",
}


def _already_in_game_detail(exc: duel_service.DuelConflictError) -> dict[str, str]:
    return {
        "code": "CHAT_INVITE_ALREADY_IN_GAME",
        "existing_room_id": str(exc.existing_room_id),
    }


@router.post(
    "/conversations/{friendship_id}/invite",
    response_model=ChatMessageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_invite_user_limit],
)
async def send_invite(
    friendship_id: uuid.UUID,
    _body: ChatInviteCreate | None = None,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> ChatMessageRead:
    """Send a duel-invite chat message. 403 `CHAT_NOT_FRIENDS` under the
    same conditions as a text message (see `app.services.chat_invite.
    send_invite`). **No duel room exists yet** — see that function's
    docstring (skeptic HIGH#1): sending never costs a duel slot, so N
    invites to N different friends all succeed.
    """
    sender_id = user.id
    try:
        message = await chat_invite_service.send_invite(
            session,
            user,
            friendship_id,
            settings.INVITE_TTL_SECONDS,
            settings.CHAT_NOTIFY_DELAY_SECONDS,
        )
    except chat_service.ChatNotFriendsError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_NOT_FRIENDS_DETAIL
        ) from exc
    await session.commit()
    logger.info(
        "chat_invite_sent",
        extra={
            "sender_id": str(sender_id),
            "conversation_id": str(message.conversation_id),
            "seq": message.seq,
        },
    )
    assert message.invite is not None  # chat_invite_service.send_invite always attaches it
    chat_service.notify_user(message.invite.invitee_id)
    return chat_invite_service.build_message_read(message, sender_id, now_utc())


@router.post("/invites/{invite_id}/accept", response_model=DuelInviteActionRead)
async def accept_invite(
    invite_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelInviteActionRead:
    """Accept a pending invite addressed to the caller — creates/joins the
    duel room (via `app.services.duel.create_room`/`join_room`) and returns
    the caller's own fresh `session_token`. 404 unknown invite or no longer
    actionable (already resolved, or just discovered expired — same
    response either way, idempotent); 403 the invite isn't the caller's to
    accept; 409 `CHAT_INVITE_ALREADY_IN_GAME` if creating/joining the room
    hits П11 (either side already has another active duel) — the invite
    stays `pending`.
    """
    try:
        invite, room, session_token = await chat_invite_service.accept_invite(
            session, user, invite_id
        )
    except chat_invite_service.ChatInviteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_DETAIL) from exc
    except chat_invite_service.ChatInviteForbiddenError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_INVITE_FORBIDDEN_DETAIL
        ) from exc
    except chat_invite_service.ChatInviteNotActionableError as exc:
        await session.commit()  # persists an opportunistic pending->expired flip, if any
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_NOT_ACTIONABLE_DETAIL
        ) from exc
    except duel_service.DuelConflictError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_already_in_game_detail(exc)
        ) from exc
    await session.commit()
    logger.info(
        "chat_invite_accepted",
        extra={"invite_id": str(invite.id), "room_id": str(room.id), "user_id": str(user.id)},
    )
    chat_service.notify_user(invite.inviter_id)
    return DuelInviteActionRead(
        id=invite.id, state=invite.state, room_id=invite.room_id, session_token=session_token
    )


@router.post("/invites/{invite_id}/decline", response_model=DuelInviteActionRead)
async def decline_invite(
    invite_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelInviteActionRead:
    """Decline a pending invite addressed to the caller. Same 404/403/404
    shape as `accept`. A race lost to a concurrent accept is honored as a
    decline anyway — the just-created room is abandoned (see
    `app.services.chat_invite._resolve_non_accept`).
    """
    try:
        invite = await chat_invite_service.decline_invite(session, user, invite_id)
    except chat_invite_service.ChatInviteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_DETAIL) from exc
    except chat_invite_service.ChatInviteForbiddenError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_INVITE_FORBIDDEN_DETAIL
        ) from exc
    except chat_invite_service.ChatInviteNotActionableError as exc:
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_NOT_ACTIONABLE_DETAIL
        ) from exc
    await session.commit()
    chat_service.notify_user(invite.inviter_id)
    return DuelInviteActionRead(id=invite.id, state=invite.state, room_id=invite.room_id)


@router.post("/invites/{invite_id}/cancel", response_model=DuelInviteActionRead)
async def cancel_invite(
    invite_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelInviteActionRead:
    """Cancel a pending invite the caller SENT. Same 404/403/404 shape as
    `accept`/`decline`; same race courtesy for a concurrent accept.
    """
    try:
        invite = await chat_invite_service.cancel_invite(session, user, invite_id)
    except chat_invite_service.ChatInviteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_DETAIL) from exc
    except chat_invite_service.ChatInviteForbiddenError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_INVITE_FORBIDDEN_DETAIL
        ) from exc
    except chat_invite_service.ChatInviteNotActionableError as exc:
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_INVITE_NOT_ACTIONABLE_DETAIL
        ) from exc
    await session.commit()
    chat_service.notify_user(invite.invitee_id)
    return DuelInviteActionRead(id=invite.id, state=invite.state, room_id=invite.room_id)
