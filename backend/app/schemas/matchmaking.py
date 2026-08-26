"""Wire schemas for `/matchmaking/*` — friends-hub plan, Этап C."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class MatchmakingStatusRead(BaseModel):
    """Response of `POST /matchmaking/enqueue` and `GET /matchmaking/poll` —
    same shape either way. `matched=False` is a normal "still waiting"
    outcome, not an error — `room_id`/`session_token` are both `None` then.
    """

    model_config = ConfigDict(extra="forbid")

    matched: bool
    room_id: UUID | None = None
    session_token: str | None = None
