"""Daily-scramble attempt + board routes.

All endpoints require an authenticated active user (`current_active_user`);
anon callers get 401. `POST .../start` and `POST .../submit` are the ONLY
places in the app that ever reveal the shared daily scramble (П8) — both
authed, neither public. `GET /current` is authed too but its
`DailyCurrentRead` schema has no scramble field at all, and it is read-only:
it never creates a daily challenge or attempt row and never starts the
deadline clock (see `daily_service.get_current_daily_attempt`).

`GET /current/board` is likewise authed and strictly read-only: it creates
nothing, starts no clock, and returns NO scramble. Its `DailyBoardRead`
response is also privacy-scoped (П10) — it never selects or serializes
`email` or `nickname`, only the caller-chosen `public_handle` (or "Аноним"),
and is deliberately de-ranked: no rank/position field anywhere in the
payload.

No public (anon) route exists in this brick and none may be added without
re-checking that invariant.

Plumbing only: `honesty` is set to "pending" on every attempt and this brick
never transitions it — see `app.models.daily` / the plan. This is a PARALLEL
vertical to `app.routers.tournament` (untouched); submit here does NOT call
the badge engine.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import timedelta
from typing import cast

from app.config import get_settings
from app.db import get_session
from app.models import DailyAttempt, DailyChallenge, User
from app.schemas.daily import (
    AttemptStatus,
    DailyAttemptRead,
    DailyAttemptSubmit,
    DailyBoardRead,
    DailyCurrentRead,
    DailyStreakRead,
)
from app.services import daily as daily_service
from app.services import streak as streak_service
from app.services.auth import current_active_user
from app.services.ratelimit import ip_rate_limit

settings = get_settings()

router = APIRouter(prefix="/daily", tags=["daily"])

_ip_limit = Depends(ip_rate_limit(settings.DAILY_RATE_LIMIT))


def _to_read(attempt: DailyAttempt, daily: DailyChallenge) -> DailyAttemptRead:
    return DailyAttemptRead(
        id=attempt.id,
        daily_id=attempt.daily_id,
        status=attempt.status,
        honesty=attempt.honesty,
        time_ms=attempt.time_ms,
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        date=daily.date,
        day_label=daily_service.day_label(daily.date),
        event=daily.event,
        scramble=daily.scramble,
    )


def _to_current_read(
    daily: DailyChallenge | None, attempt: DailyAttempt | None
) -> DailyCurrentRead:
    if daily is None:
        today = daily_service.current_day()
        return DailyCurrentRead(
            date=today,
            day_label=daily_service.day_label(today),
            event=daily_service.EVENT,
            attempt_status=None,
            time_ms=None,
            started_at=None,
            submitted_at=None,
            deadline_at=None,
        )

    deadline_at = None
    attempt_status: AttemptStatus | None = None
    time_ms = None
    started_at = None
    submitted_at = None
    if attempt is not None:
        attempt_status = cast(AttemptStatus, attempt.status)
        time_ms = attempt.time_ms
        started_at = attempt.started_at
        submitted_at = attempt.submitted_at
        deadline_at = attempt.started_at + timedelta(seconds=settings.DAILY_ATTEMPT_WINDOW_SECONDS)

    return DailyCurrentRead(
        date=daily.date,
        day_label=daily_service.day_label(daily.date),
        event=daily.event,
        attempt_status=attempt_status,
        time_ms=time_ms,
        started_at=started_at,
        submitted_at=submitted_at,
        deadline_at=deadline_at,
    )


@router.get("/current", response_model=DailyCurrentRead)
async def get_current(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyCurrentRead:
    """Read-only current-day daily-challenge state for the caller.

    NEVER returns the scramble (``DailyCurrentRead`` has no such field — П8)
    and NEVER creates a challenge/attempt row or starts the deadline clock;
    it only SELECTs what already exists via
    ``daily_service.get_current_daily_attempt``.
    """
    daily, attempt = await daily_service.get_current_daily_attempt(session, user.id)
    return _to_current_read(daily, attempt)


@router.get("/streak", response_model=DailyStreakRead)
async def get_streak(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyStreakRead:
    """Derived daily streak for the caller (V3 "Цели и стрики").

    Read-only and storage-free: the numbers are computed from the caller's own
    finished attempts (see ``app.services.streak``). No scramble (П8), no other
    user's data, nothing created.
    """
    return DailyStreakRead(**await streak_service.get_streak(session, user.id))


@router.get(
    "/current/board",
    response_model=DailyBoardRead,
    dependencies=[_ip_limit],
)
async def get_current_board(
    limit: int = Query(default=settings.DAILY_BOARD_LIMIT_DEFAULT, gt=0),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyBoardRead:
    """De-ranked current-day participation board.

    Authed (401 anon), rate-limited, strictly read-only: creates nothing,
    starts no clock, returns NO scramble. NEVER selects/serializes `email` or
    `nickname` — only `public_handle` (or "Аноним", П10) — and carries NO
    rank/position field (de-ranked by design; true ranking is a future brick).
    `limit` is clamped to `DAILY_BOARD_LIMIT_MAX`.
    """
    clamped_limit = min(limit, settings.DAILY_BOARD_LIMIT_MAX)
    board = await daily_service.get_current_daily_board(session, user.id, clamped_limit)
    return DailyBoardRead(
        date=board.date,
        day_label=daily_service.day_label(board.date),
        event=board.event,
        entries=board.entries,
        your_entry=board.your_entry,
        valid_count=board.valid_count,
        dnf_count=board.dnf_count,
    )


@router.post(
    "/current/attempt/start",
    response_model=DailyAttemptRead,
    dependencies=[_ip_limit],
)
async def start_attempt(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyAttemptRead:
    """Get-or-create today's daily challenge + the caller's attempt.

    Idempotent: a second call by the same user on the same UTC day reloads
    the existing attempt (incl. a terminal one) and the same shared scramble
    — no new row, no re-roll.
    """
    daily = await daily_service.get_or_create_current_daily(session)
    attempt = await daily_service.get_or_create_daily_attempt(session, user.id, daily.id)
    await session.commit()
    await session.refresh(daily)
    await session.refresh(attempt)
    return _to_read(attempt, daily)


@router.post(
    "/current/attempt/submit",
    response_model=DailyAttemptRead,
    dependencies=[_ip_limit],
)
async def submit_attempt(
    payload: DailyAttemptSubmit,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyAttemptRead:
    """Record the caller's result against their already-started attempt.

    No create here: 404 if today has no daily challenge yet, or the caller
    has no attempt for it. 409 if the attempt is already terminal
    (valid|dnf). A submit arriving after the attempt window forces status
    "dnf" regardless of the payload. NO badge evaluation happens here (this
    brick has no daily badges).
    """
    today = daily_service.current_day()
    daily_result = await session.execute(select(DailyChallenge).where(DailyChallenge.date == today))
    daily = daily_result.scalar_one_or_none()
    if daily is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No daily challenge today"
        )

    attempt_result = await session.execute(
        select(DailyAttempt).where(
            DailyAttempt.user_id == user.id,
            DailyAttempt.daily_id == daily.id,
        )
    )
    attempt = attempt_result.scalar_one_or_none()
    if attempt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No attempt started today"
        )

    if attempt.status != "started":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Attempt already submitted"
        )

    now = daily_service.now_utc()
    if daily_service.is_past_deadline(attempt, now, settings.DAILY_ATTEMPT_WINDOW_SECONDS):
        attempt.status = "dnf"
    else:
        attempt.status = payload.status
        attempt.time_ms = payload.time_ms
    attempt.submitted_at = now

    session.add(attempt)
    await session.commit()
    await session.refresh(attempt)
    return _to_read(attempt, daily)
