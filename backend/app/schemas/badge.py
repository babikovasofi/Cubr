from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BadgeRead(BaseModel):
    """One row of the badge registry, merged with the caller's grant (if any).

    Participation/self-reported only — never implies honesty verification
    (see `app.services.badges` module docstring).
    """

    model_config = ConfigDict(from_attributes=True)

    code: str
    title: str
    description: str
    icon: str
    earned: bool
    earned_at: datetime | None = None
