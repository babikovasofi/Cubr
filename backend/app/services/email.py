"""Transactional email delivery (verification + password reset).

The public ``send_verification_email`` / ``send_reset_email`` coroutines are the
seam the routers/UserManager call and that tests monkeypatch with a spy — they
never touch the network in tests. A mail-provider outage is logged, not raised,
so a down mailbox can never turn an auth request into a 500.
"""

import logging

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger("cubr.email")

_RESEND_ENDPOINT = "https://api.resend.com/emails"
_BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


async def _post_resend(settings: Settings, to: str, subject: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            _RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html},
        )
        resp.raise_for_status()


async def _post_brevo(settings: Settings, to: str, subject: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            _BREVO_ENDPOINT,
            headers={"api-key": settings.BREVO_API_KEY},
            json={
                "sender": {"email": settings.EMAIL_FROM},
                "to": [{"email": to}],
                "subject": subject,
                "htmlContent": html,
            },
        )
        resp.raise_for_status()


async def _send(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    try:
        if settings.EMAIL_PROVIDER == "brevo":
            await _post_brevo(settings, to, subject, html)
        else:
            await _post_resend(settings, to, subject, html)
    except (httpx.HTTPError, httpx.HTTPStatusError):
        # Never bubble a mail outage up into the auth request.
        logger.exception("Failed to send %r email to %s", subject, to)


async def send_verification_email(to: str, token: str) -> None:
    settings = get_settings()
    link = f"{settings.FRONTEND_URL}/verify?token={token}"
    html = f'<p>Welcome to Cubr! Confirm your email:</p><p><a href="{link}">{link}</a></p>'
    await _send(to, "Confirm your Cubr email", html)


async def send_reset_email(to: str, token: str) -> None:
    settings = get_settings()
    link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    html = f'<p>Reset your Cubr password:</p><p><a href="{link}">{link}</a></p>'
    await _send(to, "Reset your Cubr password", html)
