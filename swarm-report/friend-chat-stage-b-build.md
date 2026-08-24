# Build report — friend-chat Stage B (письма)

Собран Этап B плана [friend-chat-plan.md](friend-chat-plan.md) — уведомление о
новом сообщении по почте. Этап A (чат) уже на проде и не тронут; Этап C
(ретеншн-пурж, наблюдаемость) не в объёме.

## Правило письма (как в плане)
Решение о письме принимает **отложенная развёртка**, не обработчик отправки:
у сообщения `notify_after = created_at + 5 мин`, внешний cron раз в минуту
собирает непрочитанное у людей, которых нет на сайте, и шлёт **одно письмо на
переписку, не чаще раза в час**, максимум 3 письма в сутки на переписку. В письме
только факт и публичное имя отправителя — **никогда текст сообщения**.

## Backend (python-fastapi)

- `migrations/versions/0016_chat_email.py` (down_revision `0015_chat`) — таблицы
  `email_prefs` (chat_email_enabled, unsubscribed_at, token_version) и
  `chat_email_state` ((conversation_id, recipient_id) PK, last_email_at,
  emails_sent). Проверена up/down/up на живом Postgres.
- `app/services/unsubscribe_token.py` — HMAC-токен (sign/verify) + `build_links()`,
  общий для развёртки и роутера.
- `app/services/email_prefs.py` — чтение/запись флага, `unsubscribe_by_token`;
  `token_version` растёт на каждом реальном переходе (в обе стороны) — старая
  ссылка из письма умирает.
- `app/services/email.py` — параметр `headers` протянут в Resend/Brevo payload;
  `send_chat_notification(...)` — только факт, ставит `List-Unsubscribe` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), глотает сбои
  провайдера как `_send`.
- `app/jobs/chat_notify.py` — развёртка: группировка по переписке+получателю,
  досбор не-дозревших сообщений в одно письмо, часовой троттл + дневной cap,
  **claim-then-send идемпотентность** (пометить `sent` под повторной проверкой
  `notify_state='pending'` ДО отправки; потерянное письмо лучше дубля), сводка
  `chat_notify_sweep` каждый запуск. Запуск `python -m app.jobs.chat_notify`.
  Использует уже готовую чистую `chat_notify.decide()` (N1–N10) из Этапа A.
- `app/routers/email.py` — `POST /email/unsubscribe` (без авторизации, one-click,
  **без редиректа**, токен одноразовый), `GET`/`PUT /email/prefs` (cookie).
- `app/config.py` / `.env.example` — `UNSUBSCRIBE_SIGN_SECRET` (Field min_length=32,
  в guard-цикле плейсхолдеров), `CHAT_EMAIL_INTERVAL_SECONDS=3600`,
  `CHAT_EMAIL_MAX_PER_CONVERSATION_PER_DAY=3`.

### Контракт для фронта
- `POST /email/unsubscribe` — токен `?token=` или JSON `{token}`. 200 text/plain,
  400 на битый/просроченный/повторный. Одноразовый.
- `GET /email/prefs` → `{chat_email_enabled}` (нет строки = true). Аноним 401.
- `PUT /email/prefs {chat_email_enabled}` (extra=forbid) → 200 та же форма.

## Frontend (react-ts)

- `frontend/src/pages/UnsubscribePage.tsx` + роут `/unsubscribe` — читает
  `?token=`, кнопка «Отписаться». **Не шлёт запрос на маунте** (почтовые клиенты
  предзагружают ссылки) — только по клику POST-ит токен.
- `frontend/src/pages/ProfilePage.tsx` — тумблер «Письма о новых сообщениях от
  друзей» через `GET`/`PUT /email/prefs` (переиспользован SegmentedToggle).
- `frontend/src/pages/legal/PrivacyRu.tsx` + `PrivacyEn.tsx` — правки §5 в этом же
  изменении: хранение сообщений (≤12 мес), новый вид письма (адрес получателя +
  текст письма провайдеру, но не текст сообщения), «друг видит публичное имя и что
  ты на сайте», отписка кнопкой; дата «обновлено» → 24 августа 2026. RU/EN синхронны.
- `frontend/src/api/email.ts`, `client.ts` — клиент + `PUT` в union методов.

## Тесты

| Набор | Команда | Результат |
|---|---|---|
| backend | `uv run pytest -q` | **686 passed, 1 skipped** |
| backend | ruff / ruff format / mypy | чисто |
| frontend | `npx vitest run` | **1902 passed / 125 files** |
| frontend | tsc / eslint / build | чисто; bundle 268.2/320 kB |

Покрыто §8 Stage B: sweep happy (3 непрочит. → 1 письмо, все `sent`), граница часа
3599/3600, дневной cap 3-е шлёт / 4-е `throttled_expired`, **баг Decidim** (час
прошёл + новое сообщение → второе письмо, троттл не подавление), идемпотентность
нахлёстывающихся sweep → одно письмо, провайдер недоступен → лог без падения,
удаление дружбы при pending → `unfriended`, ноль писем, отписка (валидный POST →
200; повторно → 400; после ре-подписки старая ссылка → 400); фронт — страница
отписки не бьёт в сеть на маунте, тумблер читает/пишет prefs.

## Devops (в этом же коммите, применяется при деплое)
- `docs/deploy.md` §7 — cron-строка `* * * * * … python -m app.jobs.chat_notify`
  (раз в минуту, идемпотентна) + `/var/log/cubr-chat-notify.log`.
- §0 — секретов теперь шесть (добавлен `UNSUBSCRIBE_SIGN_SECRET`).

## Открытый пункт перед доверием живой почте
Проверить на **живом письме**, что заголовки из поля `headers` Resend попадают в
тег `h=` DKIM-подписи (RFC 8058 требует). Не считать сделанным по факту наличия
заголовка в исходнике (план, Assumptions).
- `open_link` в письме сейчас ведёт на `{FRONTEND_URL}/friends` (пер-переписочного
  диплинка нет) — чат Этапа A открывается оттуда.
