# Plan: friends-hub (slug: friends-hub)

Переработка друзей и социального взаимодействия. Три отгружаемых этапа:
**A** — экран /friends + полиш чата; **B** — приглашение на дуэль сообщением в
чате (кнопки Принять/Отклонить); **C** — случайный матчмейкинг.

## TL;DR

Выносим друзей на свой экран `/friends` (стиль «Плейфул-поп»), причёсываем чат,
меняем сырую дуэль-ссылку на **invite-сообщение** с полным жизненным циклом, и
добавляем очередь случайного соперника. Дуэль-по-ссылке не ломаем.

## Разрешение находок скептика (вшито в план)

- **HIGH#1 — комнату НЕ создаём при отправке invite.** create_room сразу вставляет
  `DuelParticipant(active=True)`, а partial-UNIQUE(user_id) даёт ровно ОДНУ активную
  дуэль. Если комната рождается на отправке — приглашающий заблокирован на 24ч
  (open-TTL), 5 приглашений разным друзьям невозможны. **Комната создаётся на
  ACCEPT**, invite хранит только намерение. Отправка N приглашений стоит 0 слотов.
- **HIGH#2 — своя таблица `duel_invites` — источник правды состояния.** У
  ChatMessage нет колонки состояния; выводить из DuelRoom.status нельзя (кнопка
  «Принять» в старом сообщении соврёт). Таблица: `(id, message_id FK, inviter_id,
  invitee_id, state CHECK('pending'|'accepted'|'declined'|'canceled'|'expired'),
  room_id NULL, created_at, expires_at, resolved_at)`. Кнопка рисуется по строке
  каждый poll, активна только `state=='pending' AND now<expires_at`.
- **HIGH#3 — очередь матчмейкинга в БД, не в памяти.** Деплой = рестарт процесса =
  память теряется, игрок «в очереди» ждёт вечно. Таблица `matchmaking_queue` (по
  образцу `user_presence`, пережившего рестарт): enqueue = строка; long-poll
  каждый цикл перепроверяет пару; рестарт роняет висящий poll, клиент
  перезапрашивает со строкой на месте.
- **HIGH#4 — детерминированный единственный создатель комнаты + фильтры.** При
  спаривании комнату создаёт игрок с меньшим UUID (get-or-create по
  упорядоченной паре, `friends.pair_key`); исключить пары из `chat_blocks`;
  дедуп очереди по user_id; матчмейкинг **сводит незнакомцев** — это новый скоуп
  и новое раскрытие presence/handle не-друзьям (owner подтвердил «поиск рандомных»).
- **MED — токены.** На accept минтим свежий `session_token` ОБОИМ (create-time
  токен приглашающего к моменту accept может протухнуть: TTL 2ч < open-TTL 24ч).
- **MED — письма.** Invite-сообщение НЕ идёт в chat email sweep: при вставке
  ставим terminal `notify_state` (invite — не текст, `body=NULL`, фильтр модерации
  не применяется). По умолчанию приглашения письмами не уведомляют.
- **MED — TTL invite >> задержки poll.** Не секунды, а **2–5 минут**; на карточке
  живой обратный отсчёт, по истечении кнопка гаснет, а не 404 по клику.
- **MED/LOW — teardown/регрессия.** cancel/decline → `state` + `abandon_room`
  (если комната уже была). accept идёт ЧЕРЕЗ существующие `create_room`/`join_room`
  (не форкаем вторую surface); duel-by-link и `duel_manager.py` не трогаем.

## Acceptance criteria

### Этап A — /friends + чат
- Роут `/friends` (ProtectedRoute); в шапке ссылка «Друзья».
- `FriendsSection` убран из ProfilePage (короткая ссылка «Друзья и сообщения»);
  тесты профиля зелёные.
- `/friends`: добавление по нику, входящие/исходящие заявки, список друзей с
  **presence-точкой** (сервер: `user_presence.last_seen_at`, «онлайн» = не старше
  окна), встроенный чат — по токенам design-system.
- Чат: одна poll-петля на вкладку; бабблы свои/чужие; автопрокрутка к низу;
  unread-пилюли; presence у собеседника.

### Этап B — invite в чате
- Кнопка «Позвать на дуэль» создаёт invite-СООБЩЕНИЕ (не ссылку). **Комнаты пока
  нет** — только строка `duel_invites(state=pending)`.
- Карточка invite со состоянием: получателю «Принять»/«Отклонить», отправителю
  «Отменить» + статус. Живой отсчёт до `expires_at`.
- «Принять» → **создаёт/входит в комнату** (`create_room` под lower-UUID или
  просто отправитель как player_a на accept + `join_room` получателя), обоим
  свежий `session_token`, оба навигируются в `/duel/{room_id}` (отправитель — по
  push через poll «вызов принят → войти»).
- Состояния корректны и видимы: pending/accepted/declined/canceled/expired,
  already-in-game (получатель занят → тот же 409, invite остаётся pending до TTL).
- Отправка нескольких приглашений разным друзьям НЕ упирается в П11 (комнат нет).
- Дуэль-по-ссылке работает без изменений.

### Этап C — матчмейкинг
- «Случайный соперник»: enqueue (строка в БД), «ищем…», отмена.
- Двое в очереди → одна общая комната (создатель = меньший UUID), обоим
  session_token, оба в комнате.
- Игрок с активной дуэлью в очередь не встаёт (409); себя/заблокировавших не
  матчит; дедуп по user_id.
- Очередь переживает рестарт (строка в БД); клиент перезапрашивает.

## Affected files
(см. полный список в двух отчётах агентов; ключевое)
- **A:** `frontend/src/pages/FriendsPage.tsx` (new), `App.tsx` (route+ссылка),
  `ProfilePage.tsx` (убрать FriendsSection), `friends/FriendsSection.tsx`
  (перекомпоновка), `friends/chat/{ConversationView,ConversationList}.tsx`
  (автоскролл/presence/unread); backend `services/friends.py`+`schemas/friends.py`
  (last_seen_at LEFT JOIN user_presence), `api/friends.ts` (+isOnline).
- **B:** `models/chat.py` (+`kind`; new `DuelInvite`), migration `00XX_chat_invite`,
  `services/chat_invite.py` (new — invite вынести из chat.py, файл >400),
  `routers/chat.py` (+4 ручки invite), `schemas/chat.py` (+kind/invite),
  `api/chat.ts` (invite-методы), `friends/chat/InviteMessage.tsx` (new),
  `ConversationView.tsx` (кнопка+рендер), `useChatPoll.ts` (рефетч открытой
  переписки на poll-wake — смена state не пере-выдаётся курсором), `config.py`
  (INVITE_TTL_SECONDS, CHAT_PRESENCE_ONLINE_WINDOW_SECONDS).
- **C:** `models` + migration `matchmaking_queue`, `services/matchmaking.py` (new),
  `routers/matchmaking.py` (new, long-poll БЕЗ Depends(get_session) — иначе съест
  пул), `main.py` (include), `config.py` (MATCHMAKING_*), `api/matchmaking.ts`
  (new), `friends/MatchmakingPanel.tsx` (new).

## Test plan
(полный перечень — в отчёте планировщика; обязательные акценты)
- **B lifecycle (чистая логика, приоритет):** invite pending без комнаты; accept →
  комната+оба токена+state accepted; accept чужого/повторно → 403/404 идемпотентно;
  decline/cancel → state+abandon; expired → can_accept=false, клик не 404;
  already-in-game → 409, invite остаётся pending; N приглашений разным друзьям без
  409; seq invite гаплесс с текстом; **email sweep НЕ шлёт письмо на invite**.
- **C:** двое enqueue → одна пара/один room; гонка трёх enqueue → ровно одна пара;
  enqueue при активной дуэли → 409; блок/сам себя не матчит; очередь переживает
  рестарт (строка в БД); **poll не держит пул** (N>pool, параллельный запрос жив).
- **Регрессии:** alembic up/down/up на Postgres; WEB_CONCURRENCY>1 отказ; каскад
  удаления user не оставляет сирот в duel_invites/matchmaking_queue; `duel_manager.py`
  не тронут, тесты дуэлей зелёные; дуэль-по-ссылке зелёный регресс.
- **Frontend:** /friends только авторизованным; InviteMessage все состояния;
  accept→navigate; presence isOnline граница; одна poll-петля; строки через t().

## Blockers
Нет требующих решения владельца. Единственная новая seмантика — **матчмейкинг
показывает твоё имя/присутствие незнакомцам** (не только друзьям); владелец сам
попросил «поиск рандомных людей», значит принято. Приватность страницы (§5
friend-chat) для друзей не меняется.

## Out of scope
Письма о вызовах; групповые/командные дуэли; рейтинговый MMR/скилл-подбор; Redis
персистентная очередь (при WEB_CONCURRENCY=1 не нужна); invite незнакомцам по
ссылке; история приглашений; пуши/«печатает…»/реакции; смена дуэль-транспорта.

## Assumptions
- Комната рождается на accept — отдельного лока «один pending invite на переписку»
  не вводим (П11 при accept покрывает; до accept слот не занят).
- INVITE_TTL 2–5 мин (game/Discord-стиль) против 24ч у сырой ссылки.
- Presence-окно «онлайн» ~60с, в настройке.
- accept идёт через существующие create_room/join_room — новой duel-surface нет.
- /friends под ProtectedRoute; аноним → login?next=/friends.
