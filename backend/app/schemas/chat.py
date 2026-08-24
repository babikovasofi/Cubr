"""Wire schemas for `/chat/*` (Этап A — friend-chat plan).

Like `app.schemas.friend`, these never carry a bare user UUID for "the other
person" — only `display_name` (see `app.services.tournament.display_name_for`).
`sender_id` on `ChatMessageRead` IS a UUID, but it is always one of the two
IDs the caller already knows (their own, or the friend they're chatting
with) — never used to look someone up.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatMessageCreate(BaseModel):
    """Body of `POST /chat/conversations/{friendship_id}/messages`."""

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def _reject_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body must not be blank")
        return value


class ChatMessageRead(BaseModel):
    """One message, in a feed or a poll response. `body is None` means
    "deleted by its author" — the frontend renders a placeholder, never an
    error.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    seq: int
    sender_id: UUID
    body: str | None
    created_at: datetime
    deleted_at: datetime | None


class ConversationRead(BaseModel):
    """One row of `GET /chat/conversations`.

    `friendship_id` is `None` when the friendship has since been removed —
    the conversation stays visible (read-only from the frontend's
    perspective: sending requires an accepted friendship again), but there
    is no friendship row left to send through.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    friendship_id: UUID | None
    display_name: str
    last_message_body: str | None
    last_message_at: datetime | None
    unread_count: int


class ChatPollRead(BaseModel):
    """Response of `GET /chat/poll`. `cursor` is opaque — the client stores
    it and passes it back verbatim on the next call, never parses it.
    """

    model_config = ConfigDict(from_attributes=True)

    cursor: str
    messages: list[ChatMessageRead]
