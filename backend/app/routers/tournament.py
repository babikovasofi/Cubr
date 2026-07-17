"""Weekly-tournament attempt + standings routes.

All endpoints require an authenticated active user (`current_active_user`);
anon callers get 401. `POST .../start` and `POST .../submit` are the ONLY
places in the app that ever reveal the shared weekly scramble (П8) — both
authed, neither public. `GET /current` is authed too but its
`TournamentCurrentRead` schema has no scramble field at all, and it is
read-only: it never creates a tournament or attempt row and never starts the
deadline clock (see `tournament_service.get_current_attempt`).

`GET /current/standings` is likewise authed and strictly read-only: it
creates nothing, starts no clock, and returns NO scramble. Its
`TournamentStandingsRead` response is also privacy-scoped (П10) — it never
selects or serializes `email` or `nickname`, only the caller-chosen
`public_handle` (or "Аноним"), and is deliberately de-ranked: no rank/position
field anywhere in the payload.

No public (anon) route exists in this brick and none may be added without
re-checking that invariant.

Plumbing only: `honesty` is set to "pending" on every attempt and this brick
never transitions it — see `app.models.tournament` / the plan.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import timedelta
from typing import cast

from app.config import get_settings
from app.db import get_session
from app.models import Tournament, TournamentAttempt, User
from app.schemas.tournament import (
    AttemptStatus,
    TournamentAttemptRead,
    TournamentAttemptSubmit,
    TournamentCurrentRead,
    TournamentStandingsRead,
)
from app.services import tournament as tournament_service
from app.services.auth import current_active_user
from app.services.ratelimit import ip_rate_limit

settings = get_settings()

router = APIRouter(prefix="/tournament", tags=["tournament"])

_ip_limit = Depends(ip_rate_limit(settings.TOURNAMENT_RATE_LIMIT))


def _to_read(attempt: TournamentAttempt, tournament: Tournament) -> TournamentAttemptRead:
    return TournamentAttemptRead(
        id=attempt.id,
        tournament_id=attempt.tournament_id,
        status=attempt.status,
        honesty=attempt.honesty,
        time_ms=attempt.time_ms,
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        iso_year=tournament.iso_year,
        iso_week=tournament.iso_week,
        week_label=tournament_service.week_label(tournament.iso_year, tournament.iso_week),
        event=tournament.event,
        scramble=tournament.scramble,
    )


def _to_current_read(
    tournament: Tournament | None, attempt: TournamentAttempt | None
) -> TournamentCurrentRead:
    if tournament is None:
        iso_year, iso_week = tournament_service.current_iso_week()
        return TournamentCurrentRead(
            iso_year=iso_year,
            iso_week=iso_week,
            week_label=tournament_service.week_label(iso_year, iso_week),
            event=tournament_service.EVENT,
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
        deadline_at = attempt.started_at + timedelta(
            seconds=settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS
        )

    return TournamentCurrentRead(
        iso_year=tournament.iso_year,
        iso_week=tournament.iso_week,
        week_label=tournament_service.week_label(tournament.iso_year, tournament.iso_week),
        event=tournament.event,
        attempt_status=attempt_status,
        time_ms=time_ms,
        started_at=started_at,
        submitted_at=submitted_at,
        deadline_at=deadline_at,
    )


@router.get("/current", response_model=TournamentCurrentRead)
async def get_current(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> TournamentCurrentRead:
    """Read-only current-week tournament state for the caller.

    NEVER returns the scramble (``TournamentCurrentRead`` has no such field —
    П8) and NEVER creates a tournament/attempt row or starts the deadline
    clock; it only SELECTs what already exists via
    ``tournament_service.get_current_attempt``.
    """
    tournament, attempt = await tournament_service.get_current_attempt(session, user.id)
    return _to_current_read(tournament, attempt)


@router.get(
    "/current/standings",
    response_model=TournamentStandingsRead,
    dependencies=[_ip_limit],
)
async def get_current_standings(
    limit: int = Query(default=settings.TOURNAMENT_STANDINGS_LIMIT_DEFAULT, gt=0),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> TournamentStandingsRead:
    """De-ranked current-week participation board.

    Authed (401 anon), rate-limited, strictly read-only: creates nothing,
    starts no clock, returns NO scramble. NEVER selects/serializes `email` or
    `nickname` — only `public_handle` (or "Аноним", П10) — and carries NO
    rank/position field (de-ranked by design; true ranking is a future brick).
    `limit` is clamped to `TOURNAMENT_STANDINGS_LIMIT_MAX`.
    """
    clamped_limit = min(limit, settings.TOURNAMENT_STANDINGS_LIMIT_MAX)
    standings = await tournament_service.get_current_standings(session, user.id, clamped_limit)
    return TournamentStandingsRead(
        iso_year=standings.iso_year,
        iso_week=standings.iso_week,
        week_label=tournament_service.week_label(standings.iso_year, standings.iso_week),
        event=standings.event,
        entries=standings.entries,
        your_entry=standings.your_entry,
        valid_count=standings.valid_count,
        dnf_count=standings.dnf_count,
    )


@router.post(
    "/current/attempt/start",
    response_model=TournamentAttemptRead,
    dependencies=[_ip_limit],
)
async def start_attempt(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> TournamentAttemptRead:
    """Get-or-create the current week's tournament + the caller's attempt.

    Idempotent: a second call by the same user in the same week reloads the
    existing attempt (incl. a terminal one) and the same shared scramble —
    no new row, no re-roll.
    """
    tournament = await tournament_service.get_or_create_current_tournament(session)
    attempt = await tournament_service.get_or_create_attempt(session, user.id, tournament.id)
    await session.commit()
    await session.refresh(tournament)
    await session.refresh(attempt)
    return _to_read(attempt, tournament)


@router.post(
    "/current/attempt/submit",
    response_model=TournamentAttemptRead,
    dependencies=[_ip_limit],
)
async def submit_attempt(
    payload: TournamentAttemptSubmit,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> TournamentAttemptRead:
    """Record the caller's result against their already-started attempt.

    No create here: 404 if this week has no tournament yet, or the caller has
    no attempt for it. 409 if the attempt is already terminal (valid|dnf). A
    submit arriving after the attempt window forces status "dnf" regardless
    of the payload.
    """
    iso_year, iso_week = tournament_service.current_iso_week()
    tournament_result = await session.execute(
        select(Tournament).where(Tournament.iso_year == iso_year, Tournament.iso_week == iso_week)
    )
    tournament = tournament_result.scalar_one_or_none()
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No tournament this week")

    attempt_result = await session.execute(
        select(TournamentAttempt).where(
            TournamentAttempt.user_id == user.id,
            TournamentAttempt.tournament_id == tournament.id,
        )
    )
    attempt = attempt_result.scalar_one_or_none()
    if attempt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No attempt started this week"
        )

    if attempt.status != "started":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Attempt already submitted"
        )

    now = tournament_service.now_utc()
    if tournament_service.is_past_deadline(
        attempt, now, settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS
    ):
        attempt.status = "dnf"
    else:
        attempt.status = payload.status
        attempt.time_ms = payload.time_ms
    attempt.submitted_at = now

    session.add(attempt)
    await session.commit()
    await session.refresh(attempt)
    return _to_read(attempt, tournament)
