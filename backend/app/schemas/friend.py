"""Wire schemas for `/friends/*`.

None of these EVER carries `email` or a user UUID — only `friendship_id`
(the id of the FRIENDSHIP row, not a person) and `display_name` (`handle`
or "Аноним" — see `app.services.tournament.display_name_for`). See the
friends plan's acceptance criteria: a response leaking either of the
former is a bug, not a style choice.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FriendRequestCreate(BaseModel):
    """Body of `POST /friends/requests` — the ONLY way to name a target
    user is their own opt-in `handle`. No email/id field exists here on
    purpose.
    """

    model_config = ConfigDict(extra="forbid")

    handle: str = Field(min_length=1, max_length=64)

    @field_validator("handle")
    @classmethod
    def _strip(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("handle must not be blank")
        return trimmed


class FriendRead(BaseModel):
    """One row of `GET /friends`."""

    model_config = ConfigDict(from_attributes=True)

    friendship_id: UUID
    display_name: str
    since: datetime


class FriendRequestRead(BaseModel):
    """One row of `GET /friends/requests/incoming` or `.../outgoing`."""

    model_config = ConfigDict(from_attributes=True)

    friendship_id: UUID
    display_name: str
    created_at: datetime
