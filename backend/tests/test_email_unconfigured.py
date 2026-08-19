"""Ненастроенный почтовый провайдер обязан быть слышен.

Ревью прода 2026-08-19 нашло состояние, в котором `RESEND_API_KEY` пуст: письма
не уходили, а регистрация и `/auth/forgot-password` честно отвечали 202. Ошибка
провайдера гасилась тем же `except`, что и реальный сбой сети, поэтому в логах
не было ни строчки. Человек, забывший пароль, терял аккаунт навсегда, и узнать
об этом было неоткуда.

Второе: адрес получателя больше не подставляется в сообщение об ошибке — при
ненастроенном провайдере падала КАЖДАЯ отправка, то есть почта каждого
зарегистрировавшегося оседала в docker-логах на диске VPS.
"""

import logging

import httpx
import pytest

from app.services import email as email_service


@pytest.fixture(autouse=True)
def _reset_warning_latch() -> None:
    email_service._warned_unconfigured = False


async def test_missing_key_warns_and_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    posted: list[str] = []

    async def _post(*args: object, **kwargs: object) -> None:
        posted.append("sent")

    monkeypatch.setattr(email_service, "_post_resend", _post)
    monkeypatch.setattr(email_service.get_settings(), "RESEND_API_KEY", "", raising=False)

    with caplog.at_level(logging.WARNING, logger="cubr.email"):
        await email_service.send_reset_email("someone@example.com", "tok")

    assert posted == []  # в сеть не ходили
    assert "no API key" in caplog.text
    assert "RESEND_API_KEY" in caplog.text
    # И предупреждение объясняет ПОСЛЕДСТВИЕ, а не только факт.
    assert "cannot recover" in caplog.text


async def test_warning_is_not_repeated_for_every_letter(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(email_service.get_settings(), "RESEND_API_KEY", "", raising=False)
    with caplog.at_level(logging.WARNING, logger="cubr.email"):
        for _ in range(5):
            await email_service.send_verification_email("someone@example.com", "tok")
    assert caplog.text.count("no API key") == 1


async def test_delivery_failure_does_not_log_the_recipient(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def _boom(*args: object, **kwargs: object) -> None:
        raise httpx.ConnectError("provider down")

    monkeypatch.setattr(email_service, "_post_resend", _boom)
    monkeypatch.setattr(
        email_service.get_settings(), "RESEND_API_KEY", "re_live_key", raising=False
    )

    with caplog.at_level(logging.ERROR, logger="cubr.email"):
        await email_service.send_reset_email("victim@example.com", "tok")

    assert "Failed to send" in caplog.text  # сбой виден
    assert "victim@example.com" not in caplog.text  # а чужая почта — нет


async def test_a_configured_provider_still_sends(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []

    async def _post(settings: object, to: str, subject: str, html: str) -> None:
        sent.append((to, subject))

    monkeypatch.setattr(email_service, "_post_resend", _post)
    monkeypatch.setattr(
        email_service.get_settings(), "RESEND_API_KEY", "re_live_key", raising=False
    )

    await email_service.send_verification_email("new@example.com", "tok")
    assert sent == [("new@example.com", "Confirm your Cubr email")]
