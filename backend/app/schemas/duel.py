from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PlayerSlot = Literal["a", "b"]
# Coarse wire vocabulary for inbound `status_update` (frontend's
# `PlayerRitualPhase` in duelMachine.ts — the four buckets the local ritual's
# finer-grained useSoloSession phases collapse into via `ritualPhaseToWire`).
# MUST stay a superset of what the client actually sends: a phase outside
# this Literal fails Pydantic validation and is silently dropped by
# `app.routers.duel._dispatch` (extra="forbid" + a caught ValidationError) —
# the opponent then never sees that status change.
DuelStatusPhase = Literal["preparing", "ready", "solving", "finished"]


class DuelRoomCreateRead(BaseModel):
    """Response for `POST /duel/rooms` and `POST /duel/rooms/{id}/rematch`.

    Carries the freshly-minted `session_token` (bound to `(room_id,
    player_a_id)` — the caller) the client threads into the WS `?token=`
    query param. Deliberately has NO `scramble` field (П8-style secrecy — see
    `DuelRoom` model docstring: the scramble is revealed ONLY over WS `start`).
    """

    model_config = ConfigDict(from_attributes=True)

    room_id: UUID
    invite_token: str
    session_token: str
    mode: str
    event: str
    join_url: str


class DuelRoomRead(BaseModel):
    """Response for `GET /duel/rooms/{id}` — participant-only bootstrap/reconnect
    read. Deliberately has NO `scramble` field.
    """

    model_config = ConfigDict(from_attributes=True)

    room_id: UUID
    status: str
    mode: str
    event: str
    your_slot: PlayerSlot
    opponent_present: bool


class DuelJoinRead(BaseModel):
    """Response for `POST /duel/join/{invite_token}`."""

    model_config = ConfigDict(from_attributes=True)

    room_id: UUID
    session_token: str
    status: str


class WsStatusUpdateIn(BaseModel):
    """Inbound WS frame: the caller reports their own ritual phase."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["status_update"]
    phase: DuelStatusPhase


class WsFinishIn(BaseModel):
    """Inbound WS frame: the caller's self-reported solve result.

    `time_ms` is required even on a `dnf` (mirrors `SolveCreate`'s existing
    convention). `verify_frames_ok` is the raw, unread anti-cheat signal —
    stored, never interpreted as a verdict (§П5).
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["finish"]
    time_ms: int = Field(gt=0)
    dnf: bool = False
    verify_frames_ok: bool = False
