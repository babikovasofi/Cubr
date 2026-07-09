from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.health import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health(session: AsyncSession = Depends(get_session)) -> HealthOut:
    """Liveness + DB readiness — really pings the DB with ``SELECT 1``."""
    result = await session.execute(text("SELECT 1"))
    db_ok = result.scalar_one() == 1
    return HealthOut(status="ok", db="ok" if db_ok else "error")
