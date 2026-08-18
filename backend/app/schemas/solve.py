from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.badge import BadgeRead
from app.schemas.limits import MAX_SOLVE_MS


class SolveCreate(BaseModel):
    """Inbound payload for recording a solve.

    ``status`` is a client-facing Literal that deliberately excludes
    ``"rejected"`` — that value is server-only (anti-cheat), so a client can
    never self-assign it.
    """

    model_config = ConfigDict(extra="forbid")

    scramble: str = Field(max_length=512)
    time_ms: int = Field(gt=0, le=MAX_SOLVE_MS)
    status: Literal["valid", "dnf"] = "valid"
    verify_frames_ok: bool = False
    cube_id: UUID | None = None
    # Signed token from GET /scramble (app.services.scramble_token). When
    # present and valid, the server-authoritative scramble text from the
    # token replaces `scramble` above and solve.scramble_id is linked;
    # omitted (offline/anon local-fallback) → scramble_id stays NULL.
    scramble_token: str | None = None


class SolveRead(BaseModel):
    """Public representation of a persisted solve."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scramble: str
    time_ms: int
    status: str
    verify_frames_ok: bool
    cube_id: UUID | None
    scramble_id: UUID | None
    created_at: datetime
    # Badges newly granted by THIS solve (not the caller's full history) —
    # best-effort, see app.services.badges / app.routers.solves.
    new_badges: list[BadgeRead] = []
