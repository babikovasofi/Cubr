"""Wire schemas for `/email/prefs` (friend-chat plan, Этап B)."""

from pydantic import BaseModel, ConfigDict


class EmailPrefsRead(BaseModel):
    """`GET /email/prefs` response. A user with no `EmailPrefs` row (never
    touched the toggle) reads as `chat_email_enabled=True` — see
    `app.models.chat.EmailPrefs`'s docstring: no row means enabled.
    """

    model_config = ConfigDict(from_attributes=True)

    chat_email_enabled: bool


class EmailPrefsUpdate(BaseModel):
    """Body of `PUT /email/prefs`."""

    model_config = ConfigDict(extra="forbid")

    chat_email_enabled: bool
