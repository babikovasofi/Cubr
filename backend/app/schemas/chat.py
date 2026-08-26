"""Wire schemas for `/chat/*` (Этап A/B — friend-chat + friends-hub plans).

Like `app.schemas.friend`, these never carry a bare user UUID for "the other
person" — only `display_name` (see `app.services.tournament.display_name_for`).
`sender_id` on `ChatMessageRead` IS a UUID, but it is always one of the two
IDs the caller already knows (their own, or the friend they're chatting
with) — never used to look someone up. `DuelInviteRead.inviter_id`/
`invitee_id` follow the same rule (Этап B): the invite only ever appears
inside a conversation the caller is already part of.
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


class DuelInviteRead(BaseModel):
    """A duel invite's CURRENT state, embedded on a `kind == "invite"`
    `ChatMessageRead`. Always built fresh (never derived automatically from
    the ORM row) by `app.services.chat_invite.build_invite_read` — see that
    function's docstring for why `state` and `session_token` both need
    caller-aware logic a bare `.model_validate()` can't provide.

    `state` is the DERIVED value (`app.services.chat_invite.
    effective_state`) — an unmet `expires_at` on a still-DB-`pending` row
    reports `"expired"` here even before anything persists that transition.

    `session_token` is `None` unless the CALLER is a participant of an
    `accepted` invite with a `room_id` — freshly minted on every read (same
    stateless, multi-valid-token model as `app.services.duel_token`
    everywhere else in the app), never stored. This is how the INVITER
    (who never called a duel REST endpoint themselves — `accept_invite`
    creates the room on their behalf) gets their own token: their next
    `GET /chat/poll`-triggered refetch of the open conversation re-derives
    it here.

    `can_accept`/`can_decline`/`can_cancel` are CALLER-scoped booleans (not
    "is this invite pending in general" — a bystander reading someone
    else's message list never sees this row, but the same message renders
    differently for the inviter vs. the invitee): only the invitee can
    accept/decline, only the inviter can cancel, and all three are `False`
    once `state != "pending"`. This is the whole point of shipping them
    computed — the frontend button's enabled/disabled state is never
    re-derived client-side from `state` + "am I the inviter" logic that
    could drift from the server's own rules. `seconds_left` is the
    live-countdown clock source, floored at 0, and only meaningful while
    `state == "pending"` (0 otherwise).
    """

    model_config = ConfigDict(extra="forbid")

    id: UUID
    inviter_id: UUID
    invitee_id: UUID
    state: str
    room_id: UUID | None
    expires_at: datetime
    can_accept: bool
    can_decline: bool
    can_cancel: bool
    seconds_left: int
    session_token: str | None = None


class ChatMessageRead(BaseModel):
    """One message, in a feed or a poll response. `body is None` means
    "deleted by its author" for a `kind == "text"` message — the frontend
    renders a placeholder, never an error. For `kind == "invite"`, `body` is
    ALWAYS `None` and `invite` carries the actual content to render.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    seq: int
    sender_id: UUID
    body: str | None
    kind: str = "text"
    invite: DuelInviteRead | None = None
    created_at: datetime
    deleted_at: datetime | None


class ChatInviteCreate(BaseModel):
    """Body of `POST /chat/conversations/{friendship_id}/invite` — empty on
    purpose (mirrors the friend-request-by-handle shape: the ONLY thing the
    caller supplies is which friendship to invite through; everything else —
    `expires_at`, the eventual room — is server-decided).
    """

    model_config = ConfigDict(extra="forbid")


class DuelInviteActionRead(BaseModel):
    """Response of `POST /chat/invites/{id}/accept|decline|cancel`.

    `session_token` is populated ONLY by `accept` (the accepting caller's
    own fresh token, handed back immediately so they can navigate straight
    into `/duel/{room_id}` without a second round trip) — always `None` for
    decline/cancel.
    """

    id: UUID
    state: str
    room_id: UUID | None
    session_token: str | None = None


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
    last_message_kind: str | None = None
    last_message_at: datetime | None
    unread_count: int


class ChatPollRead(BaseModel):
    """Response of `GET /chat/poll`. `cursor` is opaque — the client stores
    it and passes it back verbatim on the next call, never parses it.
    """

    model_config = ConfigDict(from_attributes=True)

    cursor: str
    messages: list[ChatMessageRead]
