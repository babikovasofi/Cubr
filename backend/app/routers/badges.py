"""`GET /badges`: the full badge registry for the caller, merged with their
earned grants. Authed only (`current_active_user`); anon -> 401.

Read-only and honesty-agnostic — never reads any honesty field (see
`app.services.badges` module docstring).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.schemas.badge import BadgeRead
from app.services import badges as badges_service
from app.services.auth import current_active_user

router = APIRouter(prefix="/badges", tags=["badges"])


@router.get("", response_model=list[BadgeRead])
async def list_badges(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[BadgeRead]:
    rows = await badges_service.list_badges_for(session, user.id)
    return [BadgeRead(**row) for row in rows]
