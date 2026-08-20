"""Transactional email delivery (verification + password reset).

The public ``send_verification_email`` / ``send_reset_email`` coroutines are the
seam the routers/UserManager call and that tests monkeypatch with a spy — they
never touch the network in tests. A mail-provider outage is logged, not raised,
so a down mailbox can never turn an auth request into a 500.
"""

import logging
import re

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger("cubr.email")

# Ключа нет — предупреждаем один раз за процесс, а не на каждое письмо: иначе
# при живой регистрации предупреждение утонет в собственных повторах.
_warned_unconfigured = False


def _warn_unconfigured(provider: str) -> None:
    global _warned_unconfigured
    if _warned_unconfigured:
        return
    _warned_unconfigured = True
    logger.warning(
        "Email provider %r has no API key: verification and password-reset mail is "
        "SILENTLY DISCARDED. Anyone who forgets their password cannot recover the "
        "account. Set %s in the server .env.",
        provider,
        "BREVO_API_KEY" if provider == "brevo" else "RESEND_API_KEY",
    )


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


# Адреса внутри ответа провайдера. Тело цитируется в лог, а провайдер имеет
# привычку возвращать адрес получателя внутри собственного текста ошибки — то
# самое, что из логов и убирали.
_EMAIL_IN_TEXT = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")

# Тело ответа режется: у провайдера оно короткое, но полагаться на это нельзя —
# лог не место для страницы HTML, если провайдер вдруг отдаст её.
_MAX_BODY = 300


def _safe_body(text: str) -> str:
    """Тело ответа провайдера, пригодное для лога: без адресов, ограниченной длины."""
    redacted = _EMAIL_IN_TEXT.sub("<email>", text.strip())
    return redacted[:_MAX_BODY] if len(redacted) <= _MAX_BODY else redacted[:_MAX_BODY] + "…"


def _provider_key(settings: Settings) -> str:
    return settings.BREVO_API_KEY if settings.EMAIL_PROVIDER == "brevo" else settings.RESEND_API_KEY


async def _send(to: str, subject: str, html: str) -> None:
    settings = get_settings()

    # Провайдер не настроен — сказать об этом ГРОМКО и один раз за процесс.
    #
    # Раньше пустой ключ уходил в обычный путь отправки, провайдер отвечал
    # ошибкой авторизации, и она гасилась тем же except ниже. Снаружи это
    # выглядело как работающая регистрация: 202, «письмо отправлено», и полная
    # тишина. Ревью прода 2026-08-19 нашло состояние, в котором подтверждение
    # адреса и восстановление пароля не работали ВООБЩЕ, и узнать об этом было
    # неоткуда — ни строчки в логах, ни признака в ответе.
    if not _provider_key(settings):
        _warn_unconfigured(settings.EMAIL_PROVIDER)
        return

    try:
        if settings.EMAIL_PROVIDER == "brevo":
            await _post_brevo(settings, to, subject, html)
        else:
            await _post_resend(settings, to, subject, html)
    except httpx.HTTPStatusError as e:
        # Провайдер ОТВЕТИЛ и отказал — причина лежит в теле ответа, и только там.
        #
        # Живой разбор 2026-08-20: письма не уходили, в логах был голый
        # `403 Forbidden`, а настоящая причина («The cubr-game.ru domain is not
        # verified») пришла в теле. Её пришлось доставать руками, отдельным
        # запросом к API провайдера. Статус без тела отвечает «не получилось»,
        # но не отвечает «почему», а починка у каждой причины своя: домен без
        # верификации, отправитель на чужом домене, исчерпанная квота.
        logger.exception(
            "Failed to send %r email: %s %s",
            subject,
            e.response.status_code,
            _safe_body(e.response.text),
        )
    except httpx.HTTPError:
        # Сеть/таймаут: ответа нет вовсе, цитировать нечего.
        #
        # Адрес получателя ни в одну из веток НЕ подставляется. При
        # ненастроенном провайдере падала каждая отправка, то есть каждая
        # регистрация и каждый запрос сброса пароля клали чужую почту в
        # docker-логи, которые лежат на диске VPS и в списке хранимых данных на
        # странице приватности не упомянуты.
        logger.exception("Failed to send %r email", subject)


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
