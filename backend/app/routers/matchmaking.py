"""Random-opponent matchmaking routes — friends-hub plan, Этап C. Every
route requires an authenticated active user (anon -> 401).

`GET /matchmaking/poll` mirrors `app.routers.chat`'s `GET /chat/poll`
EXACTLY in shape, for the EXACT same reason (see that router's module
docstring): it must NOT use `Depends(get_session)`/
`Depends(current_active_user)`, because both hold a pooled DB connection
open for the whole request via FastAPI's dependency-injection lifetime —
fatal for an endpoint that parks for up to
`MATCHMAKING_POLL_TIMEOUT_SECONDS`. It authenticates off the raw cookie and
opens/closes its own short-lived sessions around each DB phase, same as
`chat.poll`.

`POST /matchmaking/enqueue` and `POST /matchmaking/cancel` are ordinary
short requests and use the normal `Depends(get_session)`/
`Depends(current_active_user)` shape.
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import OAuthAccount, User
from app.schemas.matchmaking import MatchmakingStatusRead
from app.services import chat as chat_service
from app.services import duel as duel_service
from app.services import matchmaking as matchmaking_service
from app.services import ratelimit
from app.services.auth import UserManager, current_active_user, get_jwt_strategy, password_helper

logger = logging.getLogger("cubr.matchmaking")

settings = get_settings()

router = APIRouter(prefix="/matchmaking", tags=["matchmaking"])

_ALREADY_IN_GAME_DETAIL_CODE = "MATCHMAKING_ALREADY_IN_GAME"

_enqueue_user_limit = Depends(
    ratelimit.user_rate_limit(settings.MATCHMAKING_RATE_LIMIT, scope="matchmaking-enqueue")
)


def _already_in_game_detail(exc: duel_service.DuelConflictError) -> dict[str, str]:
    return {"code": _ALREADY_IN_GAME_DETAIL_CODE, "existing_room_id": str(exc.existing_room_id)}


def _status_read(result: matchmaking_service.MatchResult | None) -> MatchmakingStatusRead:
    if result is None:
        return MatchmakingStatusRead(matched=False)
    return MatchmakingStatusRead(
        matched=True, room_id=result.room_id, session_token=result.session_token
    )


@router.post("/enqueue", response_model=MatchmakingStatusRead, dependencies=[_enqueue_user_limit])
async def enqueue(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> MatchmakingStatusRead:
    """Join the random-opponent queue, or immediately pair if a candidate
    is already waiting. `matched=False` (200, not an error) means "queued,
    still waiting" — the client then polls `GET /matchmaking/poll`. 409
    `MATCHMAKING_ALREADY_IN_GAME` if the caller already has another active
    duel elsewhere.
    """
    try:
        result, notify_candidate_id = await matchmaking_service.enqueue(session, user)
    except duel_service.DuelConflictError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_already_in_game_detail(exc)
        ) from exc
    await session.commit()
    if notify_candidate_id is not None:
        # Only after commit — see app.services.matchmaking.enqueue's
        # docstring for why a pre-commit notify would be a wasted wake.
        chat_service.notify_user(notify_candidate_id)
    if result is not None:
        logger.info(
            "matchmaking_paired",
            extra={"user_id": str(user.id), "room_id": str(result.room_id)},
        )
    return _status_read(result)


@router.post("/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Leave the queue. No-op (204, not 404) if the caller isn't queued."""
    await matchmaking_service.cancel(session, user.id)
    await session.commit()


async def _authenticate_short(request: Request) -> User:
    """Cookie-JWT auth for `GET /matchmaking/poll` ONLY — mirrors
    `app.routers.chat._authenticate_short` exactly (same JWT strategy, same
    cookie name), duplicated rather than imported: each long-poll route
    owns its own short-lived-session auth helper (see that router's module
    docstring), not shared as a cross-router private import.
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


async def _poll_phase(user_id: uuid.UUID) -> matchmaking_service.MatchResult | None:
    """One short DB phase: check-and-maybe-consume, commit, close. NEVER
    held open across the `asyncio.wait_for` wait — mirrors
    `app.routers.chat._poll_phase`.
    """
    from app.db import async_session_maker

    async with async_session_maker() as session:
        result = await matchmaking_service.poll_once(session, user_id)
        await session.commit()
        return result


@router.get("/poll", response_model=MatchmakingStatusRead)
async def poll(request: Request) -> MatchmakingStatusRead:
    """Long-poll: has the caller been matched yet? See module docstring for
    why this route does NOT use `Depends(get_session)`/
    `Depends(current_active_user)`. `matched=False` (never 404) if the
    caller isn't queued at all OR is queued but still waiting — the client
    can't distinguish "never enqueued" from "queued, no match yet" from
    this response alone, which is fine: it only ever calls `/poll` after a
    successful `/enqueue` anyway.
    """
    user = await _authenticate_short(request)
    await ratelimit.enforce_user_rate_limit(
        settings.MATCHMAKING_POLL_RATE_LIMIT, "matchmaking-poll", user.id
    )

    event = chat_service.get_poll_event(user.id)
    result = await _poll_phase(user.id)
    if result is None:
        try:
            await asyncio.wait_for(event.wait(), timeout=settings.MATCHMAKING_POLL_TIMEOUT_SECONDS)
        except TimeoutError:
            pass
        result = await _poll_phase(user.id)

    return _status_read(result)
