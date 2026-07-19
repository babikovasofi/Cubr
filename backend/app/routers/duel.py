"""Link-invite duel routes: REST room lifecycle (create/get/join/rematch) +
the realtime WS room.

All REST endpoints require an authenticated active user (`current_active_user`);
anon callers get 401. `GET /duel/rooms/{id}` and every REST response schema
here deliberately carry NO `scramble` field — the ONLY place a duel's shared
scramble is ever revealed is the WS `start` message, once both players are
connected (see `app.models.duel.DuelRoom` / `app.services.duel.persist_scramble`).

WS handshake (`/duel/ws/{room_id}`), in order — CSWSH-hardened (skeptic
HIGH#2 fix): Origin-allowlist (close 4403) -> cookie-JWT auth via
`app.services.ws_auth` (close 4401) -> `duel_token.verify(...)` bound to
`(room_id, user_id)` (close 4401) -> room/participant membership (close 4404).
A bare cookie is NOT sufficient on its own (see `ws_auth` docstring) — the
signed, room+user-bound token is what actually proves this caller is one of
THIS room's two invited players, not just any logged-in user who obtained the
join URL.

Plumbing only: every duel's `a_honesty`/`b_honesty` stay "pending" forever
(`app.services.duel`/`app.models.duel`) and `winner_id` never reads them.
`solves` is NEVER written by this brick (§П5 PB-invariant frozen).

The realtime engine (`app.services.duel_manager.ConnectionManager`) is a
single process-lifetime, in-memory singleton — see that module's docstring
and `main.py`'s startup `lifespan` (refuses to boot with `WEB_CONCURRENCY > 1`).
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.models.duel import DuelRoom
from app.schemas.duel import (
    DuelH2HRead,
    DuelJoinRead,
    DuelRoomCreateRead,
    DuelRoomRead,
    PlayerSlot,
    WsFinishIn,
    WsStatusUpdateIn,
)
from app.services import badges as badges_service
from app.services import duel as duel_service
from app.services import duel_token
from app.services.auth import current_active_user
from app.services.duel import PlayerOutcome
from app.services.duel_manager import ConnectionManager
from app.services.duel_token import DuelTokenError
from app.services.ratelimit import ip_rate_limit
from app.services.ws_auth import get_ws_user

logger = logging.getLogger("cubr.duel")

settings = get_settings()

router = APIRouter(prefix="/duel", tags=["duel"])

_ip_limit = Depends(ip_rate_limit(settings.DUEL_RATE_LIMIT))

# A room in either of these DB statuses has no corresponding in-memory
# `RoomState` (`ConnectionManager._cleanup` already tore it down at
# finalize/abandon time). See `_terminal_room_state`.
_TERMINAL_STATUSES = {"finished", "abandoned"}


# ---------------------------------------------------------------------------
# In-memory realtime engine (module-level singleton — see module docstring).
# Each callback opens its OWN short-lived session: the timers that eventually
# fire these run on asyncio.Tasks outside any particular WS request's session.
# ---------------------------------------------------------------------------


async def _on_activate(room_id: uuid.UUID, scramble: str) -> None:
    from app.db import async_session_maker

    async with async_session_maker() as session:
        room = await session.get(DuelRoom, room_id)
        if room is None:
            return
        await duel_service.persist_scramble(session, room, scramble)
        await session.commit()


async def _on_finalize(
    room_id: uuid.UUID, outcome_a: PlayerOutcome, outcome_b: PlayerOutcome
) -> uuid.UUID | None:
    from app.db import async_session_maker

    async with async_session_maker() as session:
        room = await session.get(DuelRoom, room_id)
        if room is None:
            return None
        room = await duel_service.finalize_room(
            session,
            room,
            a_time_ms=outcome_a.time_ms,
            a_status=outcome_a.status,
            a_verify_frames_ok=outcome_a.verify_frames_ok,
            a_finished_at=outcome_a.finished_at,
            b_time_ms=outcome_b.time_ms,
            b_status=outcome_b.status,
            b_verify_frames_ok=outcome_b.verify_frames_ok,
            b_finished_at=outcome_b.finished_at,
        )
        # Best-effort: a badge-engine fault must never abort the duel finalize.
        try:
            await badges_service.evaluate_duel_finalized(session, room)
        except Exception:
            logger.exception("badge evaluation failed for duel finalize (room_id=%s)", room_id)
        await session.commit()
        return room.winner_id


async def _on_abandon(room_id: uuid.UUID) -> None:
    from app.db import async_session_maker

    async with async_session_maker() as session:
        room = await session.get(DuelRoom, room_id)
        if room is None:
            return
        await duel_service.abandon_room(session, room)
        await session.commit()


manager = ConnectionManager(
    on_activate=_on_activate,
    on_finalize=_on_finalize,
    on_abandon=_on_abandon,
    prep_timeout_seconds=settings.DUEL_PREP_TIMEOUT_SECONDS,
    solve_timeout_seconds=settings.DUEL_SOLVE_TIMEOUT_SECONDS,
    disconnect_grace_seconds=settings.DUEL_DISCONNECT_GRACE_SECONDS,
    heartbeat_interval_seconds=settings.DUEL_HEARTBEAT_INTERVAL_SECONDS,
    heartbeat_timeout_seconds=settings.DUEL_HEARTBEAT_TIMEOUT_SECONDS,
    countdown_seconds=settings.DUEL_COUNTDOWN_SECONDS,
)


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------


def _your_slot(room: DuelRoom, user_id: uuid.UUID) -> PlayerSlot:
    return "a" if user_id == room.player_a_id else "b"


def _room_create_read(room: DuelRoom, session_token: str) -> DuelRoomCreateRead:
    return DuelRoomCreateRead(
        room_id=room.id,
        invite_token=room.invite_token,
        session_token=session_token,
        mode=room.mode,
        event=room.event,
        join_url=f"{settings.FRONTEND_URL}/duel/join/{room.invite_token}",
    )


def _room_read(room: DuelRoom, user_id: uuid.UUID) -> DuelRoomRead:
    return DuelRoomRead(
        room_id=room.id,
        status=room.status,
        mode=room.mode,
        event=room.event,
        your_slot=_your_slot(room, user_id),
        opponent_present=room.player_b_id is not None,
    )


def _join_read(room: DuelRoom, session_token: str) -> DuelJoinRead:
    return DuelJoinRead(room_id=room.id, session_token=session_token, status=room.status)


@router.post(
    "/rooms",
    response_model=DuelRoomCreateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_ip_limit],
)
async def create_room(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelRoomCreateRead:
    """Create a new link-invite duel room with the caller as `player_a`.

    409s with `existing_room_id` if the caller already has another active
    duel (П11, enforced by `DuelParticipant`'s partial UNIQUE).
    """
    try:
        room = await duel_service.create_room(session, user.id)
    except duel_service.DuelConflictError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"existing_room_id": str(exc.existing_room_id)},
        ) from exc
    await session.commit()
    await session.refresh(room)
    session_token = duel_token.sign(
        user.id, room.id, settings.DUEL_SIGN_SECRET, settings.DUEL_SESSION_TOKEN_TTL_SECONDS
    )
    return _room_create_read(room, session_token)


@router.get("/rooms/{room_id}", response_model=DuelRoomRead)
async def get_room(
    room_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelRoomRead:
    """Participant-only bootstrap/reconnect read. NEVER returns the scramble."""
    room = await session.get(DuelRoom, room_id)
    if room is None or user.id not in (room.player_a_id, room.player_b_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Duel room not found")
    return _room_read(room, user.id)


@router.get("/rooms/{room_id}/h2h", response_model=DuelH2HRead)
async def get_h2h(
    room_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelH2HRead:
    """Head-to-head record between the caller and the room's OTHER player,
    aggregated live (read-only) over every `finished` room between exactly
    that pair. Room-scoped (not an arbitrary `opponent_user_id` param) so
    the opponent is always someone the caller already shares a room with —
    no enumeration surface. Participant guard mirrors `get_room`; a room
    with no `player_b_id` yet (nobody to compare against) also 404s.
    """
    room = await session.get(DuelRoom, room_id)
    if room is None or user.id not in (room.player_a_id, room.player_b_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Duel room not found")
    if room.player_b_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Duel room not found")
    opponent_id = room.player_b_id if user.id == room.player_a_id else room.player_a_id
    counts = await duel_service.h2h_record(session, user.id, opponent_id)
    return DuelH2HRead(
        played=counts.played,
        your_wins=counts.your_wins,
        opponent_wins=counts.opponent_wins,
        draws=counts.draws,
        opponent_user_id=opponent_id,
    )


@router.post("/join/{invite_token}", response_model=DuelJoinRead, dependencies=[_ip_limit])
async def join_room(
    invite_token: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelJoinRead:
    """Join a room by its invite link.

    Idempotent for an existing participant (reconnect). 404 unknown/expired
    invite; 409 room already full with someone else, or the joiner already
    has another active duel elsewhere (П11).
    """
    try:
        room = await duel_service.join_room(
            session, invite_token, user.id, settings.DUEL_INVITE_TTL_SECONDS
        )
    except duel_service.DuelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found or expired"
        ) from exc
    except duel_service.DuelRoomFullError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Duel room already full"
        ) from exc
    except duel_service.DuelConflictError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"existing_room_id": str(exc.existing_room_id)},
        ) from exc
    await session.commit()
    await session.refresh(room)
    session_token = duel_token.sign(
        user.id, room.id, settings.DUEL_SIGN_SECRET, settings.DUEL_SESSION_TOKEN_TTL_SECONDS
    )
    return _join_read(room, session_token)


@router.post(
    "/rooms/{room_id}/rematch",
    response_model=DuelRoomCreateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_ip_limit],
)
async def rematch(
    room_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DuelRoomCreateRead:
    """Get-or-create the rematch child of `room_id` — idempotent under a
    double-click by both players (see `duel_service.rematch`).
    """
    parent = await session.get(DuelRoom, room_id)
    if parent is None or user.id not in (parent.player_a_id, parent.player_b_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Duel room not found")
    try:
        child = await duel_service.rematch(session, parent, user.id)
    except duel_service.DuelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Duel room not found"
        ) from exc
    await session.commit()
    await session.refresh(child)
    session_token = duel_token.sign(
        user.id, child.id, settings.DUEL_SIGN_SECRET, settings.DUEL_SESSION_TOKEN_TTL_SECONDS
    )
    return _room_create_read(child, session_token)


# ---------------------------------------------------------------------------
# WS
# ---------------------------------------------------------------------------


def _terminal_room_state(room: DuelRoom) -> dict[str, Any]:
    """`room_state` snapshot for a room that has already concluded, built
    directly from the DB row.

    `ConnectionManager` has no `RoomState` for a finished/abandoned room —
    `_cleanup` tears it down in the same tick the room finalizes/is
    abandoned — so `manager.snapshot()` can't serve this. Without this
    short-circuit, a WS reconnect after the duel already ended (e.g. a hard
    reload on the result screen) would fall into `manager.connect()`, which
    silently recreates a brand-new EMPTY `RoomState` (phase `waiting`) and,
    once both players are "present" again, would re-`_activate()` it — a
    fresh random scramble, `persist_scramble` flipping the DB row's `status`
    back to `"active"` — resurrecting an already-finished duel. See
    `duel_ws`, which routes terminal-status rooms here instead of through
    `manager.connect()`/`_dispatch` at all.
    """
    if room.status == "finished":
        phase = "result"
        result: dict[str, Any] | None = {
            "players": [
                {"slot": "a", "status": room.a_status, "time_ms": room.a_time_ms},
                {"slot": "b", "status": room.b_status, "time_ms": room.b_time_ms},
            ],
            "winner_id": str(room.winner_id) if room.winner_id is not None else None,
        }
    else:  # "abandoned" — mirrors frontend's fallbackPhaseFromRoomStatus mapping
        phase = "opponent_left"
        result = None
    return {
        "type": "room_state",
        "phase": phase,
        "event": room.event,
        "scramble": room.scramble,
        "opponent_present": False,
        "opponent_phase": None,
        "prep_deadline_at": None,
        "server_start_at": None,
        "solve_deadline_at": None,
        "result": result,
    }


async def _dispatch(room_id: uuid.UUID, user_id: uuid.UUID, raw: dict[str, Any]) -> None:
    """Handle one live (non-terminal-room) inbound frame.

    `join` is REQUESTED by the client on every WS open, including a
    reconnect (see `useDuelSocket.ts`) — the server never pushes `room_state`
    unprompted; `duel_ws` deliberately sends nothing right after `connect()`.
    """
    msg_type = raw.get("type")
    if msg_type == "status_update":
        try:
            payload = WsStatusUpdateIn.model_validate(raw)
        except ValidationError:
            return
        await manager.set_status(room_id, user_id, payload.phase)
    elif msg_type == "finish":
        try:
            finish_payload = WsFinishIn.model_validate(raw)
        except ValidationError:
            return
        await manager.record_finish(
            room_id,
            user_id,
            time_ms=finish_payload.time_ms,
            dnf=finish_payload.dnf,
            verify_frames_ok=finish_payload.verify_frames_ok,
        )
    elif msg_type == "ping":
        await manager.ping(room_id, user_id)
    elif msg_type == "join":
        snapshot = manager.snapshot(room_id, user_id)
        if snapshot is not None:
            await manager.send(room_id, user_id, snapshot)
    # Unknown/malformed type: silently ignored — keeps the connection alive.


@router.websocket("/ws/{room_id}")
async def duel_ws(
    websocket: WebSocket,
    room_id: uuid.UUID,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> None:
    await websocket.accept()

    origin = websocket.headers.get("origin")
    if origin is None or origin not in settings.duel_allowed_ws_origins:
        await websocket.close(code=4403)
        return

    user = await get_ws_user(websocket, session)
    if user is None:
        await websocket.close(code=4401)
        return

    try:
        verified = duel_token.verify(token, settings.DUEL_SIGN_SECRET)
    except DuelTokenError:
        await websocket.close(code=4401)
        return
    if verified.room_id != room_id or verified.user_id != user.id:
        await websocket.close(code=4401)
        return

    room = await session.get(DuelRoom, room_id)
    if room is None or user.id not in (room.player_a_id, room.player_b_id):
        # The creator (player_a) is allowed to hold a socket while the room is
        # still `open` (player_b_id is None) — they sit in `waiting_opponent`
        # and receive the `start` broadcast the moment the invitee connects
        # (see ConnectionManager.connect's lone-waiter path). Only a truly
        # unknown room or a non-participant is rejected.
        await websocket.close(code=4404)
        return

    if room.status in _TERMINAL_STATUSES:
        # The duel already concluded — no `RoomState` to `connect()` into
        # (see `_terminal_room_state`). Serve `room_state` straight from the
        # DB row on `join`/reconnect and otherwise just idle: `status_update`/
        # `finish` are meaningless here and NOT dispatched at all, and we
        # deliberately do not close the socket ourselves (any close code
        # other than 4401/4403 makes `useDuelSocket.ts` reconnect-loop
        # forever — see that file's FATAL_CLOSE_CODES). The client closes it
        # normally when the result screen unmounts.
        while True:
            try:
                raw = await websocket.receive_json()
            except WebSocketDisconnect:
                return
            except ValueError:
                continue
            if not isinstance(raw, dict):
                continue
            if raw.get("type") == "join":
                await websocket.send_json(_terminal_room_state(room))
            elif raw.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    await manager.connect(
        room_id,
        user.id,
        player_a_id=room.player_a_id,
        player_b_id=room.player_b_id,
        event=room.event,
        websocket=websocket,
    )
    # No unprompted push here: the client sends `join` on every WS open
    # (incl. reconnect) to REQUEST the snapshot — see `_dispatch`'s `join`
    # branch and `useDuelSocket.ts`'s onopen handler.

    try:
        while True:
            try:
                raw = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except ValueError:
                continue  # malformed frame — ignore, keep the connection alive
            if not isinstance(raw, dict):
                continue
            await _dispatch(room_id, user.id, raw)
    finally:
        await manager.disconnect(room_id, user.id)
