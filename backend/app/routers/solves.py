"""Solve routes: record a solve (`POST /solves`) and list your own
(`GET /solves`). Both require an authenticated active user.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Cube, Scramble, Solve, User
from app.schemas.badge import BadgeRead
from app.schemas.solve import SolveCreate, SolveRead
from app.services import badges as badges_service
from app.services.auth import current_active_user
from app.services.scramble_token import ScrambleTokenError
from app.services.scramble_token import verify as verify_scramble_token
from app.services.ratelimit import ip_rate_limit

logger = logging.getLogger("cubr.solves")

settings = get_settings()

_ip_limit = Depends(ip_rate_limit(settings.SOLVE_RATE_LIMIT))

router = APIRouter(prefix="/solves", tags=["solves"])


@router.post(
    "",
    response_model=SolveRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_ip_limit],
)
async def create_solve(
    payload: SolveCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> SolveRead:
    # If a cube is referenced, it must belong to the caller (else 404 — no
    # cross-user leak, and never a 500 on an unknown/foreign id).
    if payload.cube_id is not None:
        cube = await session.get(Cube, payload.cube_id)
        if cube is None or cube.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cube not found")

    # Server-authoritative scramble: with no token, trust the client's own
    # text (offline/anon local-fallback). With a token, the verified payload
    # replaces it — the client's `scramble` field can never lie.
    scramble_text = payload.scramble
    scramble_id: uuid.UUID | None = None

    if payload.scramble_token is not None:
        try:
            verified = verify_scramble_token(payload.scramble_token, settings.SCRAMBLE_SIGN_SECRET)
        except ScrambleTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
            ) from exc

        existing = await session.execute(select(Scramble).where(Scramble.nonce == verified.nonce))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Scramble token already used"
            )

        scramble_row = Scramble(
            scramble=verified.scramble, event=verified.event, nonce=verified.nonce
        )
        session.add(scramble_row)
        try:
            # Flush (not commit) so the row gets its id without ending the
            # transaction the solve insert below joins. A unique-constraint
            # race on `nonce` (concurrent double-submit) also lands here.
            await session.flush()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Scramble token already used"
            ) from exc

        scramble_id = scramble_row.id
        scramble_text = verified.scramble

    solve = Solve(
        user_id=user.id,
        duel_id=None,
        tournament_id=None,
        cube_id=payload.cube_id,
        scramble_id=scramble_id,
        scramble=scramble_text,
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

    # Best-effort: a badge-engine fault must never abort the solve write.
    try:
        new_badge_codes = await badges_service.evaluate_solve(
            session, user, payload.status, payload.time_ms
        )
    except Exception:
        logger.exception("badge evaluation failed for solve (user_id=%s)", user.id)
        new_badge_codes = []

    await session.commit()
    await session.refresh(solve)

    new_badges = [BadgeRead(**badges_service.registry_entry(code)) for code in new_badge_codes]
    return SolveRead.model_validate(solve, from_attributes=True).model_copy(
        update={"new_badges": new_badges}
    )


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
