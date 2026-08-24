"""Chat-email opt-out DB layer — Этап B of the friend-chat plan.

`EmailPrefs` rows are created lazily: no row for a user means "enabled"
(see `app.models.chat.EmailPrefs`'s docstring). Every function here handles
the missing-row case explicitly rather than relying on a `default=` at
insert time, because the sweep job (`app.jobs.chat_notify`) reads this table
far more often than anyone ever writes to it, and a `SELECT` that returns
nothing is cheaper than an `INSERT ... ON CONFLICT DO NOTHING` on every
poll.

`token_version` (see `app.services.unsubscribe_token`) bumps on every
ACTUAL state transition — enabling->disabling or disabling->enabling — so a
link signed against the version before the transition can never fire
again, including a replay of the very link that just caused the
transition. A call that sets the value to what it already was is a no-op:
bumping on every PUT (even a no-op one) would invalidate a link the user
never touched.
"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import EmailPrefs
from app.services.friends import now_utc


class UnsubscribeTokenStaleError(Exception):
    """The token verified (signature + shape are fine) but its embedded
    `token_version` no longer matches the current row — either it was
    already used once (`POST /email/unsubscribe` always bumps the version
    it just acted on), or the user has since re-subscribed and unsubscribed
    again. Renders as 400, same as a forged token — see `app.routers.email`.
    """


async def get_chat_email_enabled(session: AsyncSession, user_id: uuid.UUID) -> bool:
    prefs = await session.get(EmailPrefs, user_id)
    return prefs is None or prefs.chat_email_enabled


async def get_or_create_prefs(session: AsyncSession, user_id: uuid.UUID) -> EmailPrefs:
    prefs = await session.get(EmailPrefs, user_id)
    if prefs is None:
        prefs = EmailPrefs(user_id=user_id)
        session.add(prefs)
        await session.flush()
    return prefs


async def set_chat_email_enabled(
    session: AsyncSession, user_id: uuid.UUID, enabled: bool, now: datetime | None = None
) -> EmailPrefs:
    """`PUT /email/prefs` — cookie-authed, so the caller IS `user_id`
    (never taken from an unsubscribe token here). Bumps `token_version`
    only when `enabled` actually flips the current state (see module
    docstring). Sets/clears `unsubscribed_at` to match.
    """
    prefs = await get_or_create_prefs(session, user_id)
    if prefs.chat_email_enabled != enabled:
        prefs.token_version += 1
        prefs.chat_email_enabled = enabled
        prefs.unsubscribed_at = (now or now_utc()) if not enabled else None
    await session.flush()
    return prefs


async def unsubscribe_by_token(
    session: AsyncSession, user_id: uuid.UUID, token_version: int, now: datetime | None = None
) -> None:
    """Apply a verified unsubscribe token (see `app.routers.email`): the
    token's signature/shape were already checked by
    `app.services.unsubscribe_token.verify` — this only re-checks the
    version against the CURRENT row (stale-link replay guard) and, if it
    matches, disables chat email and bumps the version so this same link
    cannot fire twice.

    Raises `UnsubscribeTokenStaleError` if `token_version` doesn't match —
    the router turns that into 400, same as a forged token (plan §7B: "не
    отличимо от подделанного" is fine — it's not, but the RESPONSE is,
    deliberately, since either way the honest fix is "request a fresh
    email/re-check your prefs page").
    """
    prefs = await get_or_create_prefs(session, user_id)
    if prefs.token_version != token_version:
        raise UnsubscribeTokenStaleError()
    if prefs.chat_email_enabled:
        prefs.token_version += 1
    prefs.chat_email_enabled = False
    prefs.unsubscribed_at = now or now_utc()
    await session.flush()
