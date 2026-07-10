from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SolveCreate(BaseModel):
    """Inbound payload for recording a solve.

    ``status`` is a client-facing Literal that deliberately excludes
    ``"rejected"`` — that value is server-only (anti-cheat), so a client can
    never self-assign it.
    """

    model_config = ConfigDict(extra="forbid")

    scramble: str = Field(max_length=512)
    time_ms: int = Field(gt=0)
    status: Literal["valid", "dnf"] = "valid"
    verify_frames_ok: bool = False


class SolveRead(BaseModel):
    """Public representation of a persisted solve."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scramble: str
    time_ms: int
    status: str
    verify_frames_ok: bool
    created_at: datetime
