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
from app.services import email_template

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


async def _post_resend(
    settings: Settings,
    to: str,
    subject: str,
    html: str,
    text: str = "",
    headers: dict[str, str] | None = None,
) -> None:
    payload: dict[str, object] = {
        "from": settings.EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
        # Текстовая часть рядом с HTML — не украшение: письмо без неё
        # получает штраф у спам-фильтров, а часть людей читает почту в
        # клиентах, которые HTML не показывают вовсе.
        "text": text,
    }
    # Resend's `headers` field — see https://resend.com/docs/api-reference/emails/send-email.
    # Used by chat-notification mail for `List-Unsubscribe`/`List-Unsubscribe-Post`
    # (RFC 8058) — see `send_chat_notification`. Omitted entirely (not sent as
    # `{}`) when the caller has none, matching every other transactional
    # email's payload shape.
    if headers:
        payload["headers"] = headers
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            _RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json=payload,
        )
        resp.raise_for_status()


async def _post_brevo(
    settings: Settings,
    to: str,
    subject: str,
    html: str,
    text: str = "",
    headers: dict[str, str] | None = None,
) -> None:
    payload: dict[str, object] = {
        "sender": {"email": settings.EMAIL_FROM},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    if headers:
        payload["headers"] = headers
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            _BREVO_ENDPOINT,
            headers={"api-key": settings.BREVO_API_KEY},
            json=payload,
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


async def _send(
    to: str, subject: str, html: str, text: str = "", headers: dict[str, str] | None = None
) -> None:
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
            await _post_brevo(settings, to, subject, html, text, headers)
        else:
            await _post_resend(settings, to, subject, html, text, headers)
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


# Тексты писем. Держатся рядом друг с другом намеренно: два письма про доступ к
# аккаунту должны звучать одним голосом, а разъезжаются они как раз тогда, когда
# лежат в разных концах файла.
#
# «Если это были не вы» и срок жизни ссылки есть в обоих. Письмо про доступ без
# этих двух фраз читается как фишинг — и справедливо.

_VERIFY_HEADING = "Подтвердите адрес"
_VERIFY_INTRO = (
    "Остался один шаг: подтвердите почту, и аккаунт готов. "
    "Дальше можно вызвать соперника по ссылке и собирать под камерой."
)
_RESET_HEADING = "Новый пароль"
_RESET_INTRO = "Вы запросили смену пароля в Cubr. Задайте новый по кнопке ниже."


async def send_verification_email(to: str, token: str) -> None:
    settings = get_settings()
    link = f"{settings.FRONTEND_URL}/verify?token={token}"
    expires = "Ссылка действует ограниченное время — если не успели, запросите новую на сайте."
    html = email_template.render(
        preheader="Подтвердите адрес, чтобы закончить регистрацию в Cubr.",
        heading=_VERIFY_HEADING,
        intro=_VERIFY_INTRO,
        button_label="Подтвердить адрес",
        link=link,
        expires_note=expires,
        ignore_note="Если регистрацию начинали не вы, просто удалите это письмо — аккаунт "
        "останется неподтверждённым.",
    )
    text = email_template.to_plain_text(
        heading=_VERIFY_HEADING, intro=_VERIFY_INTRO, link=link, expires_note=expires
    )
    await _send(to, "Подтвердите адрес — Cubr", html, text)


async def send_reset_email(to: str, token: str) -> None:
    settings = get_settings()
    link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    expires = "Ссылка действует ограниченное время — если не успели, запросите новую на сайте."
    html = email_template.render(
        preheader="Ссылка для смены пароля в Cubr.",
        heading=_RESET_HEADING,
        intro=_RESET_INTRO,
        button_label="Задать новый пароль",
        link=link,
        expires_note=expires,
        ignore_note="Если пароль меняли не вы, ничего делать не нужно: без перехода по ссылке "
        "старый пароль продолжает работать.",
    )
    text = email_template.to_plain_text(
        heading=_RESET_HEADING, intro=_RESET_INTRO, link=link, expires_note=expires
    )
    await _send(to, "Новый пароль — Cubr", html, text)


def _chat_notification_intro(sender_handle: str, count: int) -> str:
    """Fact only — NEVER the message text (friend-chat plan §5, "Что
    показываем в письме"): who, and how many. `count` is always >= 1 (a
    sweep pass never composes an email for zero pending messages).
    """
    if count == 1:
        return f"{sender_handle} написал вам в Cubr. Загляните в переписку, чтобы прочитать."
    return (
        f"{sender_handle} написал вам {count} новых сообщений в Cubr. "
        "Загляните в переписку, чтобы прочитать."
    )


async def send_chat_notification(
    to: str,
    sender_handle: str,
    count: int,
    open_link: str,
    unsubscribe_link: str,
    list_unsubscribe_post_url: str,
) -> None:
    """One chat-notification email, covering `count` pending messages from
    `sender_handle` in one conversation (`app.jobs.chat_notify`'s sweep
    sends at most one of these per conversation per pass — see that
    module).

    Body is fact-only (public handle + count) — see `_chat_notification_intro`
    and plan §5: the message TEXT never appears here, not in the HTML, not
    in the plain-text part, and therefore never in Resend's/Brevo's logs or
    ours either.

    Sets `List-Unsubscribe` (both a `mailto:` fallback is deliberately
    OMITTED — we have no inbound-mail handler to receive it, and an
    unhandled mailto is worse than a single well-formed HTTPS URI, which
    RFC 8058 requires "at least one" of) and `List-Unsubscribe-Post:
    List-Unsubscribe=One-Click` (RFC 8058) so a one-click-capable mail
    client can unsubscribe a recipient without them ever opening the
    email — the alternative most people reach for instead is the "Spam"
    button, which costs the whole domain's reputation (plan §1.2/§9).

    On mail-provider failure: logs and swallows, exactly like `_send` — the
    sweep job that calls this must never crash because a provider hiccupped.
    """
    heading = "Новое сообщение"
    intro = _chat_notification_intro(sender_handle, count)
    expires_note = "Ссылка на переписку не имеет срока действия — заходите, когда удобно."
    html = email_template.render(
        preheader=f"{sender_handle} написал вам в Cubr.",
        heading=heading,
        intro=intro,
        button_label="Открыть переписку",
        link=open_link,
        expires_note=expires_note,
        # Текст без URL — сам адрес (с токеном) прячется в `href` ссылки
        # «Отписаться», которую дорисовывает `unsubscribe_url` (см. шаблон).
        ignore_note="Не хотите получать такие письма?",
        unsubscribe_url=unsubscribe_link,
    )
    text = (
        email_template.to_plain_text(
            heading=heading, intro=intro, link=open_link, expires_note=expires_note
        )
        + f"\nОтписаться от писем о новых сообщениях: {unsubscribe_link}\n"
    )
    await _send(
        to,
        f"Новое сообщение от {sender_handle} — Cubr",
        html,
        text,
        headers={
            "List-Unsubscribe": f"<{list_unsubscribe_post_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )
