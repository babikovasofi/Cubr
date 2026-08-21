"""Вёрстка писем: то, что ломается молча и обнаруживается у получателя.

Почтовые клиенты не дают обратной связи: письмо либо выглядит правильно, либо
человек видит кашу и никому об этом не скажет. Поэтому проверяем не «красиво»,
а конкретные свойства, за отсутствие которых платят: вырезанные стили, срезанный
preheader, кнопку без запасной ссылки, письмо без текстовой части.
"""

import re

import pytest

from app.services import email as email_service
from app.services import email_template


def render_sample(link: str = "https://cubr-game.ru/verify?token=abc") -> str:
    return email_template.render(
        preheader="Короткая строка для списка писем",
        heading="Подтвердите адрес",
        intro="Остался один шаг.",
        button_label="Подтвердить адрес",
        link=link,
        expires_note="Ссылка действует ограниченное время.",
        ignore_note="Если это были не вы, удалите письмо.",
    )


class TestClientSurvival:
    """Свойства, без которых письмо разъедется у части получателей."""

    def test_styles_are_inline_and_there_is_no_style_tag(self) -> None:
        # Gmail в вебе вырезает <style> целиком: всё, что не в атрибуте style,
        # до человека не доедет.
        html = render_sample()
        assert "<style" not in html.lower()
        assert 'style="' in html

    def test_layout_is_tables_not_flexbox(self) -> None:
        # Outlook рендерит движком Word, где современной раскладки нет вовсе.
        html = render_sample()
        assert "<table" in html
        assert "display:flex" not in html
        assert "display:grid" not in html

    def test_nothing_is_loaded_from_outside(self) -> None:
        # Почтовики режут удалённые ресурсы до явного «показать картинки»:
        # логотип-картинкой у половины получателей станет пустой прямоугольник.
        html = render_sample()
        assert "<img" not in html
        assert "@font-face" not in html
        assert "https://fonts." not in html

    def test_body_width_is_capped_and_fluid(self) -> None:
        html = render_sample()
        assert "max-width:100%" in html
        assert "width:600px" in html


class TestContentObligations:
    """Содержательное, что легко забыть и дорого забывать."""

    def test_preheader_comes_before_the_body_and_is_hidden(self) -> None:
        html = render_sample()
        assert "Короткая строка для списка писем" in html
        hidden = re.search(
            r'<div style="display:none[^"]*">Короткая строка для списка писем</div>', html
        )
        assert hidden, "preheader должен быть скрыт в самом письме"
        # И стоять раньше текста письма — иначе в список писем попадёт не он.
        # Сравниваем с вступлением, а не с заголовком: заголовок дублируется в
        # <title>, который стоит выше preheader по построению документа.
        assert html.index("Короткая строка") < html.index("Остался один шаг")

    def test_the_link_is_present_as_text_next_to_the_button(self) -> None:
        # Часть клиентов не рисует кнопки, часть людей не жмёт на них.
        html = render_sample()
        assert html.count("https://cubr-game.ru/verify?token=abc") >= 2

    def test_expiry_and_a_way_out_are_stated(self) -> None:
        # Письмо про доступ к аккаунту без этих двух фраз читается как фишинг.
        html = render_sample()
        assert "действует ограниченное время" in html
        assert "не вы" in html

    def test_a_link_cannot_break_out_of_the_attribute(self) -> None:
        html = render_sample('https://cubr-game.ru/verify?token="><script>alert(1)</script>')
        assert "<script>" not in html
        assert "&lt;script&gt;" in html or "&#x27;" in html or "&quot;" in html


class TestPlainText:
    def test_plain_text_carries_the_link(self) -> None:
        text = email_template.to_plain_text(
            heading="Новый пароль",
            intro="Задайте новый пароль.",
            link="https://cubr-game.ru/reset-password?token=xyz",
            expires_note="Ссылка действует ограниченное время.",
        )
        assert "https://cubr-game.ru/reset-password?token=xyz" in text
        assert "<" not in text  # именно текст, а не HTML с ободранными тегами


@pytest.mark.parametrize(
    "send, expected_subject",
    [
        (email_service.send_verification_email, "Подтвердите адрес — Cubr"),
        (email_service.send_reset_email, "Новый пароль — Cubr"),
    ],
)
async def test_both_letters_go_out_with_html_and_text(
    send, expected_subject: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Оба письма собираются шаблоном и уходят с текстовой частью."""
    captured: dict[str, str] = {}

    async def _post(settings: object, to: str, subject: str, html: str, text: str = "") -> None:
        captured.update(subject=subject, html=html, text=text)

    monkeypatch.setattr(email_service, "_post_resend", _post)
    monkeypatch.setattr(email_service.get_settings(), "RESEND_API_KEY", "re_live", raising=False)

    await send("someone@example.com", "tok")

    assert captured["subject"] == expected_subject
    assert "<table" in captured["html"]
    assert captured["text"].strip()
    assert "token=tok" in captured["text"]
