"""Вёрстка писем: одна рамка на все транзакционные письма Cubr.

Почтовые клиенты — не браузеры, и правила тут другие, поэтому вёрстка выглядит
устаревшей намеренно:

* **Таблицы, а не flex/grid.** Outlook рендерит движком Word, где современная
  раскладка просто не существует.
* **Стили инлайном.** Gmail вырезает ``<style>`` целиком в веб-интерфейсе;
  всё, что не в атрибуте ``style``, до человека не доедет.
* **Никаких внешних картинок и шрифтов.** Почтовики режут удалённые ресурсы до
  явного «показать картинки», а логотип-картинка на пол-письма у половины
  получателей превратится в пустой прямоугольник. Кубик здесь выложен
  таблицей из девяти цветных ячеек — он «картинка», которую нельзя не показать.
* **Ширина 600px и ``max-width: 100%``.** Исторический размер, влезающий в
  панель просмотра любого клиента.

Содержательные вещи, которые письмо обязано делать и которые легко забыть:

* **Preheader** — строка, которую список писем показывает после темы. Без неё
  туда попадёт первое, что найдётся в разметке, обычно «Если кнопка не
  открывается…».
* **Ссылка текстом рядом с кнопкой.** Часть клиентов не рисует кнопки, часть
  людей не жмёт на них из осторожности. Ссылка должна быть видимой и
  копируемой.
* **Срок жизни ссылки и фраза «если это были не вы».** Письмо про доступ к
  аккаунту без этих двух вещей выглядит как фишинг — и по делу.
* **Тёмная тема.** Гарантий нет ни у кого: часть клиентов инвертирует цвета
  сама. Поэтому фон светлый и задан явно, а текст тёмный — при инверсии
  получается читаемо, а не белое по белому.
"""

from __future__ import annotations

from html import escape

# Палитра — из frontend/src/index.css (светлая тема). Дублирование осознанное:
# письмо не может импортировать CSS фронтенда, а расхождение в оттенке кнопки
# заметит только тот, кто откроет письмо и сайт рядом.
_INK = "#221e17"
_BG = "#fbf8f1"
_SURFACE = "#ffffff"
_MUTED = "#6b6252"
_LINE = "#e4dccb"
_PRIMARY = "#0051ba"

# Грань кубика из шапки: те же цвета, что в иконке сайта (frontend/public).
_FACE = [
    ["#c41e3a", "#fbf8f1", "#0051ba"],
    ["#ffcf00", "#009e60", "#ff5800"],
    ["#0051ba", "#ff5800", "#fbf8f1"],
]

_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"


def _cube() -> str:
    """Грань кубика таблицей: картинка, которую почтовик не может не показать."""
    rows = []
    for row in _FACE:
        cells = "".join(
            f'<td width="14" height="14" style="width:14px;height:14px;'
            f'background:{colour};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>'
            f'<td width="3" style="width:3px;font-size:0;line-height:0;">&nbsp;</td>'
            for colour in row
        )
        rows.append(
            f"<tr>{cells}</tr>"
            f'<tr><td colspan="6" height="3" style="height:3px;font-size:0;line-height:0;">'
            f"&nbsp;</td></tr>"
        )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="border-collapse:collapse;">{"".join(rows)}</table>'
    )


def render(
    *,
    preheader: str,
    heading: str,
    intro: str,
    button_label: str,
    link: str,
    expires_note: str,
    ignore_note: str,
    unsubscribe_url: str | None = None,
) -> str:
    """Собрать письмо. Все тексты приходят снаружи — шаблон ничего не решает сам.

    `unsubscribe_url` (опц.): если задан, к строке `ignore_note` дописывается
    кликабельная ссылка со словом «Отписаться» — сам URL (с токеном) в тексте не
    показывается, только в `href`. Письма verify/reset его не передают и
    рендерятся ровно как раньше.
    """
    safe_link = escape(link, quote=True)
    unsub_html = (
        f' <a href="{escape(unsubscribe_url, quote=True)}" style="color:{_PRIMARY};">Отписаться</a>'
        if unsubscribe_url
        else ""
    )
    return f"""\
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(heading)}</title>
</head>
<body style="margin:0;padding:0;background:{_BG};">
<!-- Preheader: попадает в список писем сразу после темы, в самом письме не виден. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:{_BG};padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background:{_SURFACE};
                    border:2px solid {_INK};border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:12px;">{_cube()}</td>
                <td style="font-family:{_FONT};font-size:22px;font-weight:800;
                           letter-spacing:-0.4px;color:{_INK};">Cubr</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 0 32px;font-family:{_FONT};font-size:24px;
                     line-height:1.25;font-weight:800;color:{_INK};">{escape(heading)}</td>
        </tr>
        <tr>
          <td style="padding:12px 32px 0 32px;font-family:{_FONT};font-size:16px;
                     line-height:1.6;color:{_INK};">{escape(intro)}</td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:{_PRIMARY};border:2px solid {_INK};border-radius:10px;">
                  <a href="{safe_link}"
                     style="display:inline-block;padding:13px 26px;font-family:{_FONT};
                            font-size:16px;font-weight:700;color:#ffffff;
                            text-decoration:none;">{escape(button_label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 0 32px;font-family:{_FONT};font-size:13px;
                     line-height:1.6;color:{_MUTED};">
            Если кнопка не открывается, скопируйте ссылку:<br>
            <a href="{safe_link}" style="color:{_PRIMARY};word-break:break-all;">{safe_link}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td height="1" style="height:1px;background:{_LINE};font-size:0;
                       line-height:0;">&nbsp;</td></tr>
            </table>
            <p style="margin:16px 0 0 0;font-family:{_FONT};font-size:13px;
                      line-height:1.6;color:{_MUTED};">{escape(expires_note)}</p>
            <p style="margin:8px 0 0 0;font-family:{_FONT};font-size:13px;
                      line-height:1.6;color:{_MUTED};">{escape(ignore_note)}{unsub_html}</p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-family:{_FONT};font-size:12px;color:{_MUTED};">
        Cubr — дуэли по спидкубингу
      </p>
    </td>
  </tr>
</table>
</body>
</html>"""


def to_plain_text(*, heading: str, intro: str, link: str, expires_note: str) -> str:
    """Текстовая версия.

    Отправляется рядом с HTML не для красоты: письмо без текстовой части
    получает штраф у спам-фильтров, а часть людей читает почту в клиентах,
    которые HTML не показывают вовсе.
    """
    return f"{heading}\n\n{intro}\n\n{link}\n\n{expires_note}\n"
