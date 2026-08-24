"""`app.services.email.send_chat_notification` — Этап B. Covers: fact-only
body (never the message text — there IS no message-text parameter to leak),
subject shape, `List-Unsubscribe`/`List-Unsubscribe-Post` headers (RFC 8058),
and that a provider failure is swallowed like every other transactional
email.
"""

import pytest

from app.services import email as email_service


@pytest.fixture(autouse=True)
def _configure_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_service.get_settings(), "RESEND_API_KEY", "re_live", raising=False)


async def test_singular_count_uses_singular_phrasing(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def _post(
        settings: object,
        to: str,
        subject: str,
        html: str,
        text: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        captured.update(to=to, subject=subject, html=html, text=text, headers=headers)

    monkeypatch.setattr(email_service, "_post_resend", _post)

    await email_service.send_chat_notification(
        to="bob@example.com",
        sender_handle="alicehandle",
        count=1,
        open_link="https://cubr-game.ru/friends",
        unsubscribe_link="https://cubr-game.ru/unsubscribe?token=abc",
        list_unsubscribe_post_url="https://cubr-game.ru/api/email/unsubscribe?token=abc",
    )

    assert captured["subject"] == "Новое сообщение от alicehandle — Cubr"
    assert "alicehandle" in captured["html"]  # type: ignore[operator]
    assert "написал вам в Cubr" in captured["html"]  # type: ignore[operator]


async def test_plural_count_mentions_the_number(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def _post(
        settings: object,
        to: str,
        subject: str,
        html: str,
        text: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        captured.update(html=html, text=text)

    monkeypatch.setattr(email_service, "_post_resend", _post)

    await email_service.send_chat_notification(
        to="bob@example.com",
        sender_handle="alicehandle",
        count=5,
        open_link="https://cubr-game.ru/friends",
        unsubscribe_link="https://cubr-game.ru/unsubscribe?token=abc",
        list_unsubscribe_post_url="https://cubr-game.ru/api/email/unsubscribe?token=abc",
    )

    assert "5 новых сообщений" in captured["html"]  # type: ignore[operator]


async def test_message_text_is_never_a_parameter_or_in_the_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plan §5: "Только факт, без текста сообщения." There is no
    message-body parameter on `send_chat_notification` at all — this just
    documents/locks that shape via `inspect`.
    """
    import inspect

    sig = inspect.signature(email_service.send_chat_notification)
    assert "body" not in sig.parameters
    assert "message" not in sig.parameters
    assert "text" not in sig.parameters


async def test_list_unsubscribe_headers_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def _post(
        settings: object,
        to: str,
        subject: str,
        html: str,
        text: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        captured["headers"] = headers

    monkeypatch.setattr(email_service, "_post_resend", _post)

    await email_service.send_chat_notification(
        to="bob@example.com",
        sender_handle="alicehandle",
        count=1,
        open_link="https://cubr-game.ru/friends",
        unsubscribe_link="https://cubr-game.ru/unsubscribe?token=abc",
        list_unsubscribe_post_url="https://cubr-game.ru/api/email/unsubscribe?token=abc",
    )

    headers = captured["headers"]
    assert headers == {
        "List-Unsubscribe": "<https://cubr-game.ru/api/email/unsubscribe?token=abc>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


async def test_unsubscribe_link_appears_in_html_and_text(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def _post(
        settings: object,
        to: str,
        subject: str,
        html: str,
        text: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        captured.update(html=html, text=text)

    monkeypatch.setattr(email_service, "_post_resend", _post)

    await email_service.send_chat_notification(
        to="bob@example.com",
        sender_handle="alicehandle",
        count=1,
        open_link="https://cubr-game.ru/friends",
        unsubscribe_link="https://cubr-game.ru/unsubscribe?token=abc123",
        list_unsubscribe_post_url="https://cubr-game.ru/api/email/unsubscribe?token=abc123",
    )

    assert "unsubscribe?token=abc123" in captured["html"]  # type: ignore[operator]
    assert "unsubscribe?token=abc123" in captured["text"]  # type: ignore[operator]


async def test_provider_failure_is_swallowed_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    async def _boom(*args: object, **kwargs: object) -> None:
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(email_service, "_post_resend", _boom)

    # Must not raise.
    await email_service.send_chat_notification(
        to="bob@example.com",
        sender_handle="alicehandle",
        count=1,
        open_link="https://cubr-game.ru/friends",
        unsubscribe_link="https://cubr-game.ru/unsubscribe?token=abc",
        list_unsubscribe_post_url="https://cubr-game.ru/api/email/unsubscribe?token=abc",
    )
