"""Wire schemas for `/friends/*`.

None of these EVER carries `email` or a user UUID — only `friendship_id`
(the id of the FRIENDSHIP row, not a person) and `display_name` (`handle`
or "Аноним" — see `app.services.tournament.display_name_for`). See the
friends plan's acceptance criteria: a response leaking either of the
former is a bug, not a style choice.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.services.cups import tier_bounds


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
    """One row of `GET /friends`.

    `is_online` (friends-hub plan, Этап A): the friend's presence dot — see
    `app.services.friends.list_friends`. `POST /friends/requests/{id}/accept`
    hands back a freshly-accepted friendship where the other side's
    presence is unknown at that instant (no LEFT JOIN done there) — defaults
    to `False`, corrected on the caller's next `GET /friends`.
    """

    model_config = ConfigDict(from_attributes=True)

    friendship_id: UUID
    display_name: str
    since: datetime
    is_online: bool = False


class FriendRequestRead(BaseModel):
    """One row of `GET /friends/requests/incoming` or `.../outgoing`."""

    model_config = ConfigDict(from_attributes=True)

    friendship_id: UUID
    display_name: str
    created_at: datetime


class FriendProfileRead(BaseModel):
    """`GET /friends/{friendship_id}/profile` — a FRIEND's profile, visible
    only to someone with an accepted friendship to them (see
    `app.services.friends.friend_profile`). Still no `email`/user-UUID here:
    a person is named by their `handle` (via `display_name`) and reached by
    `friendship_id` only. `cups_*` are derived from `cups` the same single
    way as `/users/me` (`app.services.cups.tier_bounds`), never stored twice.
    """

    friendship_id: UUID
    display_name: str
    avatar_url: str | None = None
    # When the two became friends (accepted-at, or created-at as a fallback).
    friends_since: datetime
    cups: int = 0
    best_single_ms: int | None = None
    best_ao5_ms: int | None = None
    # Showcase (V3): what they cube with, and since when. Opt-in content the
    # user entered specifically to display — shown here to friends.
    method: str | None = None
    cubing_since_year: int | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_rank(self) -> str:
        rank, _floor, _to_next = tier_bounds(self.cups)
        return rank

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_floor(self) -> int:
        _rank, floor, _to_next = tier_bounds(self.cups)
        return floor

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_to_next(self) -> int | None:
        _rank, _floor, to_next = tier_bounds(self.cups)
        return to_next
