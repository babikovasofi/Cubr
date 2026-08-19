"""In-memory duel-room realtime core (single-worker, П6-6 — no Redis).

`ConnectionManager` owns a `dict[room_id -> RoomState]` living in this
process's memory. `main.py`'s startup `lifespan` refuses to boot with
`WEB_CONCURRENCY > 1` specifically because none of this is shared across
worker processes.

Deliberately DB-agnostic: this module never opens a session or imports
anything from `app.db`. All persistence happens through three injected async
callbacks (`on_activate`/`on_finalize`/`on_abandon`), wired by
`app.routers.duel` to functions that open their OWN short-lived session
(mirroring `app.jobs.finalize`'s local `async_session_maker` import) — the
timers that eventually call them run on `asyncio.Task`s outside any
particular WS request's session lifecycle. This split is also why the unit
tests for this module (`tests/test_duel_manager.py`) never touch a DB: they
inject fake callbacks and short timeouts.

Phase machine per `RoomState`: `waiting` (fewer than 2 connections) ->
`prep` (`start` sent, both connected, waiting for both `ready`) ->
`countdown` (both ready, `server_start_at` broadcast) -> `solving` -> a
terminal `finished`/`abandoned` (RoomState is torn down — see `_cleanup`).

Timeout/grace/heartbeat semantics (userflow §5.4 / П6-5):
- `prep` timeout: anyone not `ready` by the deadline is forced `dnf`;
  whoever WAS ready stays a still-`pending` outcome (wins via the
  `compute_winner` pending-beats-dnf rule — see `app.services.duel`).
- `solving` timeout: anyone without a submitted `finish` by the deadline is
  forced `dnf` the same way.
- Disconnect before `solving` starts: `DISCONNECT_GRACE` to reconnect, else
  the room is abandoned. Disconnect during `solving`: NO separate grace —
  the already-running solve-deadline timer resolves it (disconnect-DNF).
- Heartbeat: a per-room watchdog forces a disconnect for any connection that
  hasn't been "touched" (any inbound frame, incl. `ping`) within
  `HEARTBEAT_TIMEOUT`.
"""

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from app.services.duel import PlayerOutcome
from app.services.scramble import random_scramble

logger = logging.getLogger(__name__)

_WAITING = "waiting"
_PREP = "prep"
_COUNTDOWN = "countdown"
_SOLVING = "solving"
_FINISHED = "finished"
_ABANDONED = "abandoned"
_PRE_SOLVE_PHASES = (_WAITING, _PREP, _COUNTDOWN)

# Internal RoomState.phase -> the wire vocabulary `room_state.phase` sends
# (frontend duelMachine.ts's `DuelPhase`). Deliberately NOT the same strings:
# the internal machine only tracks the room's shared phase, while the wire
# vocabulary also covers client-only phases (e.g. "ready_wait", derived
# locally from a player's own ritual, never broadcast). `_FINISHED`/
# `_ABANDONED` are included defensively — `RoomState` is torn down
# (`_cleanup`) in the same tick `_finalize`/`_grace_then_abandon` sets them,
# so a `snapshot()` call actually observing either is a narrow same-tick race,
# not the normal path (see `app.routers.duel`'s terminal-room short-circuit
# for the normal post-finalize/abandon reconnect path, sourced from the DB
# row instead of this in-memory state).
_PHASE_WIRE: dict[str, str] = {
    _WAITING: "waiting_opponent",
    _PREP: "preparing",
    _COUNTDOWN: "countdown",
    _SOLVING: "solving",
    _FINISHED: "result",
    _ABANDONED: "opponent_left",
}


class DuelSocket(Protocol):
    async def send_json(self, data: dict[str, Any]) -> None: ...


# (room_id, scramble) -> persist scramble + status=active; commits itself.
ActivateCallback = Callable[[uuid.UUID, str], Awaitable[None]]
# (room_id, outcome_a, outcome_b) -> persist final result; commits itself;
# returns the computed winner_id (or None).
FinalizeCallback = Callable[[uuid.UUID, PlayerOutcome, PlayerOutcome], Awaitable[uuid.UUID | None]]
# (room_id) -> persist status=abandoned; commits itself.
AbandonCallback = Callable[[uuid.UUID], Awaitable[None]]


@dataclass
class RoomState:
    room_id: uuid.UUID
    player_a_id: uuid.UUID
    # `None` while the room is still `open` and only the creator (player_a) is
    # connected — waiting for the invitee to join. Learned (once) when
    # player_b's WS connects (see `ConnectionManager.connect`).
    player_b_id: uuid.UUID | None
    event: str
    phase: str = _WAITING
    scramble: str | None = None
    connections: dict[uuid.UUID, DuelSocket] = field(default_factory=dict)
    last_seen: dict[uuid.UUID, float] = field(default_factory=dict)
    ready: set[uuid.UUID] = field(default_factory=set)
    outcomes: dict[uuid.UUID, PlayerOutcome] = field(default_factory=dict)
    server_start_at: datetime | None = None
    prep_deadline_at: datetime | None = None
    solve_deadline_at: datetime | None = None
    tasks: dict[str, "asyncio.Task[None]"] = field(default_factory=dict)

    def opponent_of(self, user_id: uuid.UUID) -> uuid.UUID | None:
        # `None` when the caller is player_a and player_b hasn't joined yet.
        return self.player_b_id if user_id == self.player_a_id else self.player_a_id

    def both_players_known(self) -> bool:
        return self.player_b_id is not None

    def slot_of(self, user_id: uuid.UUID) -> str:
        return "a" if user_id == self.player_a_id else "b"


def _outcome_payload(outcome: PlayerOutcome, slot: str) -> dict[str, Any]:
    # `slot` ("a"/"b"), not `user_id` — frontend's `DuelResult.tsx` matches
    # `result.players` to "you"/"opponent" via `p.slot === yourSlot`, not by
    # comparing raw user ids (see duelMachine.ts's `DuelPlayerResult`).
    return {
        "slot": slot,
        "status": outcome.status,
        "time_ms": outcome.time_ms,
    }


class ConnectionManager:
    def __init__(
        self,
        *,
        on_activate: ActivateCallback,
        on_finalize: FinalizeCallback,
        on_abandon: AbandonCallback,
        prep_timeout_seconds: float,
        solve_timeout_seconds: float,
        disconnect_grace_seconds: float,
        heartbeat_interval_seconds: float,
        heartbeat_timeout_seconds: float,
        countdown_seconds: float,
    ) -> None:
        self._rooms: dict[uuid.UUID, RoomState] = {}
        self._on_activate = on_activate
        self._on_finalize = on_finalize
        self._on_abandon = on_abandon
        self._prep_timeout_s = prep_timeout_seconds
        self._solve_timeout_s = solve_timeout_seconds
        self._disconnect_grace_s = disconnect_grace_seconds
        self._heartbeat_interval_s = heartbeat_interval_seconds
        self._heartbeat_timeout_s = heartbeat_timeout_seconds
        self._countdown_s = countdown_seconds

    def get(self, room_id: uuid.UUID) -> RoomState | None:
        return self._rooms.get(room_id)

    # -- connection lifecycle -------------------------------------------------

    async def connect(
        self,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        player_a_id: uuid.UUID,
        player_b_id: uuid.UUID | None,
        event: str,
        websocket: DuelSocket,
    ) -> RoomState:
        room = self._rooms.get(room_id)
        if room is None:
            room = RoomState(
                room_id=room_id, player_a_id=player_a_id, player_b_id=player_b_id, event=event
            )
            self._rooms[room_id] = room
        elif room.player_b_id is None and player_b_id is not None:
            # The creator opened their socket while the room was still `open`
            # (RoomState was created with player_b_id=None); now the invitee's
            # socket arrives carrying the freshly-assigned player_b id. Learn it
            # so activation and opponent routing work.
            room.player_b_id = player_b_id
        room.connections[user_id] = websocket
        room.last_seen[user_id] = time.monotonic()
        self._cancel_task(room, f"grace:{user_id}")
        self._ensure_watchdog(room)
        if (
            room.phase == _WAITING
            and room.player_b_id is not None
            and room.player_a_id in room.connections
            and room.player_b_id in room.connections
        ):
            await self._activate(room)
        return room

    async def disconnect(self, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        await self._handle_disconnect(room, user_id)

    async def ping(self, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        self._touch(room, user_id)
        await self.send(room_id, user_id, {"type": "pong"})

    # -- messaging --------------------------------------------------------

    async def broadcast(
        self, room_id: uuid.UUID, message: dict[str, Any], *, exclude: uuid.UUID | None = None
    ) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        for uid, ws in list(room.connections.items()):
            if uid == exclude:
                continue
            await self._safe_send(ws, message)

    async def send(self, room_id: uuid.UUID, user_id: uuid.UUID, message: dict[str, Any]) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        ws = room.connections.get(user_id)
        if ws is None:
            return
        await self._safe_send(ws, message)

    async def _safe_send(self, ws: DuelSocket, message: dict[str, Any]) -> None:
        try:
            await ws.send_json(message)
        except Exception:
            # Best-effort: the socket is already gone. The receive-loop /
            # heartbeat watchdog will detect and clean up via disconnect().
            pass

    def snapshot(self, room_id: uuid.UUID, viewer_id: uuid.UUID) -> dict[str, Any] | None:
        """Reconnect/bootstrap payload: phase, own + opponent status, scramble
        (only once revealed), remaining deadlines.
        """
        room = self._rooms.get(room_id)
        if room is None:
            return None
        opponent_id = room.opponent_of(viewer_id)
        opponent_present = opponent_id is not None and opponent_id in room.connections
        return {
            "type": "room_state",
            "phase": _PHASE_WIRE[room.phase],
            "event": room.event,
            "scramble": room.scramble,
            "opponent_present": opponent_present,
            "opponent_phase": None
            if opponent_id is None
            else ("ready" if opponent_id in room.ready else "preparing"),
            "prep_deadline_at": _iso(room.prep_deadline_at),
            "server_start_at": _iso(room.server_start_at),
            "solve_deadline_at": _iso(room.solve_deadline_at),
            # Always None here: a still-live RoomState (the only kind this
            # in-memory `snapshot()` can see) is by definition not yet
            # finalized. The post-finalize/abandon reconnect path is served
            # directly from the DB row by `app.routers.duel` instead — see
            # `_PHASE_WIRE`'s docstring.
            "result": None,
        }

    # -- gameplay -----------------------------------------------------------

    async def set_status(self, room_id: uuid.UUID, user_id: uuid.UUID, phase: str) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        self._touch(room, user_id)
        if phase == "ready":
            room.ready.add(user_id)
        opponent_id = room.opponent_of(user_id)
        # `player` is the SENDER's slot (a/b), not the literal "opponent" —
        # matches frontend's `WireStatusUpdate.player: PlayerSlot`, which
        # filters on `msg.player !== yourSlot` (see useDuelSocket.ts).
        if opponent_id is not None:
            await self.send(
                room_id,
                opponent_id,
                {"type": "status_update", "player": room.slot_of(user_id), "phase": phase},
            )
        if (
            room.phase == _PREP
            and room.player_b_id is not None
            and room.player_a_id in room.ready
            and room.player_b_id in room.ready
        ):
            await self._start_countdown(room)

    async def record_finish(
        self,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        time_ms: int,
        dnf: bool,
        verify_frames_ok: bool,
    ) -> None:
        room = self._rooms.get(room_id)
        if room is None:
            return
        self._touch(room, user_id)
        if user_id in room.outcomes:
            return  # idempotent: ignore a duplicate finish
        room.outcomes[user_id] = PlayerOutcome(
            user_id=user_id,
            status="dnf" if dnf else "valid",
            time_ms=None if dnf else time_ms,
            verify_frames_ok=verify_frames_ok,
            finished_at=datetime.now(timezone.utc),
        )
        if room.player_a_id in room.outcomes and room.player_b_id in room.outcomes:
            await self._finalize(room, forced_dnf=set())

    # -- activation / countdown / timeouts -----------------------------------

    async def _activate(self, room: RoomState) -> None:
        scramble = random_scramble()
        room.scramble = scramble
        room.phase = _PREP
        room.prep_deadline_at = datetime.now(timezone.utc) + timedelta(seconds=self._prep_timeout_s)
        await self._on_activate(room.room_id, scramble)
        await self.broadcast(
            room.room_id,
            {
                "type": "start",
                "scramble": scramble,
                "event": room.event,
                "prep_deadline_at": _iso(room.prep_deadline_at),
            },
        )
        self._schedule_task(room, "prep_timeout", self._prep_timeout(room))

    async def _prep_timeout(self, room: RoomState) -> None:
        try:
            await asyncio.sleep(self._prep_timeout_s)
        except asyncio.CancelledError:
            raise
        if room.phase != _PREP:
            return
        # _PREP is only entered via _activate, which requires both ids known.
        assert room.player_b_id is not None
        missing = {uid for uid in (room.player_a_id, room.player_b_id) if uid not in room.ready}
        await self._finalize(room, forced_dnf=missing)

    async def _start_countdown(self, room: RoomState) -> None:
        self._cancel_task(room, "prep_timeout")
        room.phase = _COUNTDOWN
        room.server_start_at = datetime.now(timezone.utc) + timedelta(seconds=self._countdown_s)
        await self.broadcast(
            room.room_id, {"type": "countdown", "server_start_at": _iso(room.server_start_at)}
        )
        self._schedule_task(room, "countdown_to_solving", self._countdown_to_solving(room))

    async def _countdown_to_solving(self, room: RoomState) -> None:
        try:
            await asyncio.sleep(self._countdown_s)
        except asyncio.CancelledError:
            raise
        if room.phase != _COUNTDOWN:
            return
        room.phase = _SOLVING
        room.solve_deadline_at = datetime.now(timezone.utc) + timedelta(
            seconds=self._solve_timeout_s
        )
        self._schedule_task(room, "solve_timeout", self._solve_timeout(room))

    async def _solve_timeout(self, room: RoomState) -> None:
        try:
            await asyncio.sleep(self._solve_timeout_s)
        except asyncio.CancelledError:
            raise
        if room.phase != _SOLVING:
            return
        assert room.player_b_id is not None  # _SOLVING is post-activation
        missing = {uid for uid in (room.player_a_id, room.player_b_id) if uid not in room.outcomes}
        await self._finalize(room, forced_dnf=missing)

    async def _finalize(self, room: RoomState, *, forced_dnf: set[uuid.UUID]) -> None:
        if room.phase in (_FINISHED, _ABANDONED):
            return  # idempotency guard: a duplicate trigger is a no-op
        # Every _finalize path is post-activation (finish/timeout/disconnect
        # during solving), so both player ids are known.
        assert room.player_b_id is not None
        now = datetime.now(timezone.utc)

        def outcome_for(uid: uuid.UUID) -> PlayerOutcome:
            if uid in room.outcomes:
                return room.outcomes[uid]
            if uid in forced_dnf:
                return PlayerOutcome(user_id=uid, status="dnf", time_ms=None, finished_at=now)
            return PlayerOutcome(user_id=uid, status="pending", time_ms=None, finished_at=None)

        outcome_a = outcome_for(room.player_a_id)
        outcome_b = outcome_for(room.player_b_id)
        room.phase = _FINISHED
        # Персист результата обязан быть НЕПРОБИВАЕМЫМ, потому что фаза уже
        # переведена в finished, а строка в БД — ещё нет.
        #
        # Живой сценарий (ревью 2026-08-19): кадр finish с time_ms больше
        # потолка INTEGER валил запись, исключение уходило наверх, `_cleanup`
        # не выполнялся — комната навсегда оставалась `active`, оба участника
        # `active`, partial-UNIQUE не давал создать новую, а ручки удаления
        # комнаты нет. Один кадр запирал дуэли обоим игрокам насовсем.
        # Верхняя граница в схемах (app.schemas.limits) закрывает конкретно
        # тот вход; этот блок закрывает КЛАСС: любая будущая ошибка на записи
        # результата освобождает комнату вместо того, чтобы её заклинить.
        try:
            winner_id = await self._on_finalize(room.room_id, outcome_a, outcome_b)
        except Exception:
            logger.exception("finalize failed for room %s, abandoning instead", room.room_id)
            winner_id = None
            try:
                await self._on_abandon(room.room_id)
            except Exception:
                logger.exception(
                    "abandon after failed finalize also failed for room %s", room.room_id
                )
        await self.broadcast(
            room.room_id,
            {
                "type": "result",
                "players": [
                    _outcome_payload(outcome_a, "a"),
                    _outcome_payload(outcome_b, "b"),
                ],
                "winner_id": str(winner_id) if winner_id is not None else None,
            },
        )
        await self._cleanup(room)

    # -- disconnect / heartbeat ----------------------------------------------

    async def _handle_disconnect(self, room: RoomState, user_id: uuid.UUID) -> None:
        if user_id not in room.connections:
            return  # already handled (idempotent)
        del room.connections[user_id]
        room.last_seen.pop(user_id, None)
        opponent_id = room.opponent_of(user_id)
        if opponent_id is not None:
            await self.send(
                room.room_id,
                opponent_id,
                {"type": "opponent_left", "grace_seconds": self._disconnect_grace_s},
            )
        if room.phase in _PRE_SOLVE_PHASES:
            self._schedule_task(room, f"grace:{user_id}", self._grace_then_abandon(room, user_id))
        elif room.phase == _SOLVING and user_id not in room.outcomes:
            # Disconnect-DNF (userflow §5.4 / plan acceptance): the leaver is
            # recorded `dnf` and the room finalizes NOW with the survivor's
            # current outcome — which stays `pending` if they hadn't submitted
            # yet. `compute_winner`'s pending-beats-dnf rule then hands the
            # survivor the win even without a submitted time, and the match
            # ends promptly instead of hanging until the full solve deadline.
            room.outcomes[user_id] = PlayerOutcome(
                user_id=user_id,
                status="dnf",
                time_ms=None,
                finished_at=datetime.now(timezone.utc),
            )
            await self._finalize(room, forced_dnf=set())

    async def _grace_then_abandon(self, room: RoomState, user_id: uuid.UUID) -> None:
        try:
            await asyncio.sleep(self._disconnect_grace_s)
        except asyncio.CancelledError:
            raise
        if user_id in room.connections:
            return  # reconnected in time
        if room.phase not in _PRE_SOLVE_PHASES:
            return  # already progressed past the point grace applies to
        room.phase = _ABANDONED
        await self._on_abandon(room.room_id)
        await self.broadcast(room.room_id, {"type": "abandoned"})
        await self._cleanup(room)

    def _touch(self, room: RoomState, user_id: uuid.UUID) -> None:
        if user_id in room.connections:
            room.last_seen[user_id] = time.monotonic()

    def _ensure_watchdog(self, room: RoomState) -> None:
        existing = room.tasks.get("watchdog")
        if existing is None or existing.done():
            room.tasks["watchdog"] = asyncio.create_task(self._watchdog(room))

    async def _watchdog(self, room: RoomState) -> None:
        try:
            while True:
                await asyncio.sleep(self._heartbeat_interval_s)
                now = time.monotonic()
                for uid in list(room.connections.keys()):
                    last = room.last_seen.get(uid, now)
                    if now - last > self._heartbeat_timeout_s:
                        await self._handle_disconnect(room, uid)
        except asyncio.CancelledError:
            raise

    # -- task bookkeeping -----------------------------------------------------

    def _schedule_task(self, room: RoomState, key: str, coro: Awaitable[None]) -> None:
        self._cancel_task(room, key)
        room.tasks[key] = asyncio.create_task(coro)  # type: ignore[arg-type]

    def _cancel_task(self, room: RoomState, key: str) -> None:
        task = room.tasks.pop(key, None)
        if task is not None and not task.done():
            task.cancel()

    async def _cleanup(self, room: RoomState) -> None:
        for key in list(room.tasks.keys()):
            self._cancel_task(room, key)
        self._rooms.pop(room.room_id, None)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
