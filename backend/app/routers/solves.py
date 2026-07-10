"""Solve routes: record a solve (`POST /solves`) and list your own
(`GET /solves`). Both require an authenticated active user.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Cube, Solve, User
from app.schemas.solve import SolveCreate, SolveRead
from app.services.auth import current_active_user

router = APIRouter(prefix="/solves", tags=["solves"])


@router.post("", response_model=SolveRead, status_code=status.HTTP_201_CREATED)
async def create_solve(
    payload: SolveCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> Solve:
    # If a cube is referenced, it must belong to the caller (else 404 — no
    # cross-user leak, and never a 500 on an unknown/foreign id).
    if payload.cube_id is not None:
        cube = await session.get(Cube, payload.cube_id)
        if cube is None or cube.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cube not found")

    solve = Solve(
        user_id=user.id,
        duel_id=None,
        tournament_id=None,
        cube_id=payload.cube_id,
        scramble=payload.scramble,
        time_ms=payload.time_ms,
        status=payload.status,
        verify_frames_ok=payload.verify_frames_ok,
    )
    session.add(solve)

    # Update the personal best only on a faster valid solve.
    if payload.status == "valid" and (
        user.best_single_ms is None or payload.time_ms < user.best_single_ms
    ):
        user.best_single_ms = payload.time_ms
        session.add(user)

    await session.commit()
    await session.refresh(solve)
    return solve


@router.get("", response_model=list[SolveRead])
async def list_solves(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[Solve]:
    result = await session.execute(
        select(Solve)
        .where(Solve.user_id == user.id)
        .order_by(Solve.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())
