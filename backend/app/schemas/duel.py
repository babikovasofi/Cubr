from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from app.schemas.limits import MAX_SOLVE_MS

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
    # Opponent identity for the "match found" / duel header (owner: show who
    # you're facing, like real games). All None until an opponent has joined.
    # In a random matchmaking duel this reveals a stranger's handle/cups — the
    # owner-approved scope of "поиск рандомных" (see friends-hub plan Этап C).
    opponent_display_name: str | None = None
    opponent_avatar_url: str | None = None
    opponent_cups: int | None = None
    opponent_cups_rank: str | None = None


class DuelH2HRead(BaseModel):
    """Response for `GET /duel/rooms/{id}/h2h` — caller vs the room's other
    participant, aggregated across every `finished` room between exactly
    that pair. Built by hand in the router from `duel_service.h2h_record`
    (no `from_attributes`).
    """

    played: int
    your_wins: int
    opponent_wins: int
    draws: int
    opponent_user_id: UUID


class DuelSeriesRead(BaseModel):
    """Response for `GET /duel/rooms/{id}/series` — the running score of the
    CURRENT SITTING of rematches containing this room (plan: rematch-series),
    as opposed to `DuelH2HRead`'s lifetime record. Derived live from the
    `parent_room_id` chain (`duel_service.series_record`) — no table, no
    migration.

    Deliberately has NO `opponent_user_id` (unlike `DuelH2HRead`): this
    surface never needed the opponent's identity in the first place, so it
    was never added (§П10) — four counters, nothing else.
    """

    played: int
    your_wins: int
    opponent_wins: int
    draws: int


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
    time_ms: int = Field(gt=0, le=MAX_SOLVE_MS)
    dnf: bool = False
    verify_frames_ok: bool = False
