"""Mutual-friends routes, added by `handle` only (never email search — see
`app.services.friends`'s module docstring for the enumeration decision).
Every route requires an authenticated active user (anon -> 401).

`POST /friends/requests` carries an extra per-CALLER rate limit
(`FRIEND_REQUEST_RATE_LIMIT`, keyed by `user.id` via
`app.services.ratelimit.user_rate_limit`) on top of the ordinary per-IP
`FRIENDS_RATE_LIMIT` every other route gets — see that dependency's
docstring for why IP alone is not a defense here.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.schemas.friend import FriendRead, FriendRequestCreate, FriendRequestRead
from app.services import friends as friends_service
from app.services.auth import current_active_user
from app.services.ratelimit import ip_rate_limit, user_rate_limit
from app.services.tournament import display_name_for

settings = get_settings()

router = APIRouter(prefix="/friends", tags=["friends"])

_ip_limit = Depends(ip_rate_limit(settings.FRIENDS_RATE_LIMIT))
_user_request_limit = Depends(user_rate_limit(settings.FRIEND_REQUEST_RATE_LIMIT))


@router.post(
    "/requests",
    response_model=FriendRequestRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_user_request_limit],
)
async def send_request(
    body: FriendRequestCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> FriendRequestRead:
    """Send a friend request by the target's `handle` (case-insensitive).

    404 unknown/inactive handle; 422 targeting your own handle; 403
    `HANDLE_REQUIRED` if the caller has no handle of their own; 409
    `FRIEND_ALREADY_PENDING` / `FRIEND_ALREADY_FRIENDS` if a row already
    exists. A reverse request (the target already requested the caller) is
    auto-accepted and returned as a 201, not a conflict — see
    `friends_service.send_request`.
    """
    try:
        friendship, other = await friends_service.send_request(session, user, body.handle)
    except friends_service.FriendNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Handle not found"
        ) from exc
    except friends_service.FriendSelfError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot friend-request yourself",
        ) from exc
    except friends_service.FriendHandleRequiredError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "HANDLE_REQUIRED", "reason": "Set your own public handle first."},
        ) from exc
    except friends_service.FriendConflictError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": f"FRIEND_ALREADY_{exc.reason}"},
        ) from exc
    await session.commit()
    return FriendRequestRead(
        friendship_id=friendship.id,
        display_name=display_name_for(other.handle),
        created_at=friendship.created_at,
    )


@router.get("", response_model=list[FriendRead], dependencies=[_ip_limit])
async def list_friends(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[FriendRead]:
    entries = await friends_service.list_friends(
        session, user.id, online_window_seconds=settings.CHAT_PRESENCE_ONLINE_WINDOW_SECONDS
    )
    return [FriendRead.model_validate(entry) for entry in entries]


@router.get("/requests/incoming", response_model=list[FriendRequestRead], dependencies=[_ip_limit])
async def list_incoming(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[FriendRequestRead]:
    entries = await friends_service.list_incoming(session, user.id)
    return [FriendRequestRead.model_validate(entry) for entry in entries]


@router.get("/requests/outgoing", response_model=list[FriendRequestRead], dependencies=[_ip_limit])
async def list_outgoing(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[FriendRequestRead]:
    entries = await friends_service.list_outgoing(session, user.id)
    return [FriendRequestRead.model_validate(entry) for entry in entries]


@router.post(
    "/requests/{friendship_id}/accept",
    response_model=FriendRead,
    dependencies=[_ip_limit],
)
async def accept_request(
    friendship_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> FriendRead:
    """Accept an incoming request. A chosen 404 (not 403) for "not yours" —
    see `friends_service.accept`'s docstring: `friendship_id` alone can't
    distinguish unknown-id from someone-else's-row, so both look the same.
    """
    try:
        friendship, other = await friends_service.accept(session, user, friendship_id)
    except friends_service.FriendNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found"
        ) from exc
    await session.commit()
    return FriendRead(
        friendship_id=friendship.id,
        display_name=display_name_for(other.handle),
        since=friendship.responded_at
        if friendship.responded_at is not None
        else friendship.created_at,
    )


@router.delete(
    "/requests/{friendship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[_ip_limit],
)
async def delete_request(
    friendship_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Decline an incoming request, or cancel an outgoing one — same route,
    same outcome (the pending row is deleted); a fresh request can be sent
    again right away.
    """
    try:
        await friends_service.delete_request(session, user, friendship_id)
    except friends_service.FriendNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found"
        ) from exc
    await session.commit()


@router.delete("/{friendship_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_ip_limit])
async def remove_friend(
    friendship_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await friends_service.remove_friend(session, user, friendship_id)
    except friends_service.FriendNotFoundError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Friend not found"
        ) from exc
    await session.commit()
