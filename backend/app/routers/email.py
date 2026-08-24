"""Chat-email preferences + unsubscribe — Этап B of the friend-chat plan.

`POST /email/unsubscribe` is the ONE route in this file that requires no
authentication — it is what a mail client's RFC 8058 one-click button (or
this app's own `/unsubscribe` frontend page) POSTs to. Its `token` proves
identity instead of a cookie: an HMAC-signed `(user_id, "chat",
token_version)` (see `app.services.unsubscribe_token`), so the request needs
no session and works from a mail client that has never logged in.

Per RFC 8058 this endpoint **MUST NOT** redirect and **MUST** act on a bare
POST without any further confirmation page — see that module's plain-text
200 response. `GET /unsubscribe?token=` (the confirmation PAGE a human
reads, with a button) is a FRONTEND route, not this one — a GET here would
be triggered by mail clients that merely prefetch/scan links, silently
unsubscribing people who never clicked anything.

`GET`/`PUT /email/prefs` are the ordinary cookie-authed toggle for the
profile page.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.schemas.email_prefs import EmailPrefsRead, EmailPrefsUpdate
from app.services import email_prefs as email_prefs_service
from app.services.auth import current_active_user
from app.services.unsubscribe_token import UnsubscribeTokenError, verify

settings = get_settings()

router = APIRouter(prefix="/email", tags=["email"])

_INVALID_TOKEN_DETAIL = "Invalid or expired unsubscribe link."


async def _extract_body_token(request: Request) -> str | None:
    """A JSON body `{"token": "..."}` — the frontend `/unsubscribe` page's
    own "Отписаться" button posts this way. A form-encoded body (the
    RFC 8058 one-click case, `List-Unsubscribe=One-Click`) carries no
    token — that request relies on the `?token=` QUERY param instead
    (the URL this app puts in the `List-Unsubscribe` header), so this
    returns `None` for it rather than parsing the form.
    """
    content_type = request.headers.get("content-type", "")
    if "application/json" not in content_type:
        return None
    try:
        body = await request.json()
    except ValueError:
        return None
    if isinstance(body, dict):
        value = body.get("token")
        if isinstance(value, str):
            return value
    return None


@router.post("/unsubscribe")
async def unsubscribe(
    request: Request,
    token: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> PlainTextResponse:
    """No auth. Accepts the token from the `?token=` query param (mail
    client one-click / any plain link) or a JSON body's `"token"` field
    (the frontend page). 200 plain text on success, 400 on a forged,
    malformed, or STALE token (already used, or invalidated by a
    subsequent re-subscribe — see `app.services.email_prefs`). Never
    redirects (RFC 8058).
    """
    resolved_token = (await _extract_body_token(request)) or token
    if not resolved_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    try:
        verified = verify(resolved_token, settings.UNSUBSCRIBE_SIGN_SECRET)
    except UnsubscribeTokenError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL
        ) from None

    try:
        await email_prefs_service.unsubscribe_by_token(
            session, verified.user_id, verified.token_version
        )
    except email_prefs_service.UnsubscribeTokenStaleError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL
        ) from None

    await session.commit()
    return PlainTextResponse(
        "Вы отписались от писем о новых сообщениях в Cubr.", status_code=status.HTTP_200_OK
    )


@router.get("/prefs", response_model=EmailPrefsRead)
async def get_prefs(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> EmailPrefsRead:
    enabled = await email_prefs_service.get_chat_email_enabled(session, user.id)
    return EmailPrefsRead(chat_email_enabled=enabled)


@router.put("/prefs", response_model=EmailPrefsRead)
async def update_prefs(
    body: EmailPrefsUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> EmailPrefsRead:
    prefs = await email_prefs_service.set_chat_email_enabled(
        session, user.id, body.chat_email_enabled
    )
    await session.commit()
    return EmailPrefsRead.model_validate(prefs)
