"""Cube-profile routes: register / list / update / delete a user's cubes.

Invariants (all enforced server-side, inside one transaction per request):
- at most 5 cubes per user (6th → 409 CUBE_LIMIT);
- exactly one ``is_primary`` cube per user;
- cross-user access is 404 (never a 403 ownership leak).

All endpoints require an authenticated active user.

MVP concurrency note: the count/limit and single-primary checks are read-then-write
without a row lock or DB constraint, so two *concurrent* writes from one account
could momentarily leave 6 cubes or two primaries. Acceptable for the single-user MVP
(the UI double-submit guard covers the common case); a Postgres partial unique index
`WHERE is_primary` or ``SELECT ... FOR UPDATE`` is the hardening if this ever matters.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Cube, User
from app.schemas.cube import CubeCreate, CubeRead, CubeUpdate
from app.services.auth import current_active_user

router = APIRouter(prefix="/cubes", tags=["cubes"])

CUBE_LIMIT = 5


async def _get_owned_cube(session: AsyncSession, user: User, cube_id: uuid.UUID) -> Cube:
    """Return the user's cube or 404. A cube owned by someone else is also 404
    (no 403 ownership leak)."""
    cube = await session.get(Cube, cube_id)
    if cube is None or cube.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cube not found")
    return cube


async def _clear_other_primaries(
    session: AsyncSession, user_id: uuid.UUID, *, keep_id: uuid.UUID | None = None
) -> None:
    """Set ``is_primary = false`` on all of the user's cubes except ``keep_id``."""
    stmt = update(Cube).where(Cube.user_id == user_id, Cube.is_primary.is_(True))
    if keep_id is not None:
        stmt = stmt.where(Cube.id != keep_id)
    await session.execute(stmt.values(is_primary=False))


@router.post("", response_model=CubeRead, status_code=status.HTTP_201_CREATED)
async def create_cube(
    payload: CubeCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> Cube:
    count = await session.scalar(
        select(func.count()).select_from(Cube).where(Cube.user_id == user.id)
    )
    if (count or 0) >= CUBE_LIMIT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "CUBE_LIMIT"})

    # First cube is always primary; an explicit is_primary demotes the rest.
    is_primary = payload.is_primary or (count or 0) == 0
    if is_primary:
        await _clear_other_primaries(session, user.id)

    cube = Cube(
        user_id=user.id,
        name=payload.name,
        note=payload.note,
        is_primary=is_primary,
        color_profile=payload.color_profile,
    )
    session.add(cube)
    await session.commit()
    await session.refresh(cube)
    return cube


@router.get("", response_model=list[CubeRead])
async def list_cubes(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[Cube]:
    result = await session.execute(
        select(Cube).where(Cube.user_id == user.id).order_by(Cube.created_at.desc())
    )
    return list(result.scalars().all())


@router.patch("/{cube_id}", response_model=CubeRead)
async def update_cube(
    cube_id: uuid.UUID,
    payload: CubeUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> Cube:
    cube = await _get_owned_cube(session, user, cube_id)

    if payload.name is not None:
        cube.name = payload.name
    if payload.note is not None:
        cube.note = payload.note
    if payload.is_primary is True:
        await _clear_other_primaries(session, user.id, keep_id=cube.id)
        cube.is_primary = True

    session.add(cube)
    await session.commit()
    await session.refresh(cube)
    return cube


@router.delete("/{cube_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cube(
    cube_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    cube = await _get_owned_cube(session, user, cube_id)
    was_primary = cube.is_primary

    await session.delete(cube)
    await session.flush()

    # If the primary cube was removed and others remain, promote the most-recent.
    if was_primary:
        survivor = await session.scalar(
            select(Cube).where(Cube.user_id == user.id).order_by(Cube.created_at.desc()).limit(1)
        )
        if survivor is not None:
            survivor.is_primary = True
            session.add(survivor)

    await session.commit()
