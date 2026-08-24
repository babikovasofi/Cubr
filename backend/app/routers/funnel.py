"""`GET /admin/funnel`: aggregate funnel counters for the operator (Stage 6).

Superuser-only: anonymous -> 401, ordinary authed user -> 403. The response is
integers only — never an email, handle, id or IP (П10). See
`app.services.funnel` for why the numbers are derived rather than tracked.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.schemas.funnel import FunnelRead
from app.services import funnel as funnel_service
from app.services.auth import current_superuser

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/funnel", response_model=FunnelRead)
async def get_funnel(
    _user: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_session),
) -> FunnelRead:
    return FunnelRead(**await funnel_service.collect_funnel(session))
