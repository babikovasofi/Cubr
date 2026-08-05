# Plan: Этап 4 — дуэль по ссылке (первый срез, без матчмейкинга)   (slug: stage4-duel-by-link)

## TL;DR
Реалтайм-WebSocket-дуэль двух аутентифицированных игроков в комнате-по-ссылке: create room
→ инвайт `/duel/join/<token>` → второй логинится и попадает в ту же комнату → синхронный старт
по серверному сигналу с ОДНИМ общим серверным скрамблом → режим Фаст (1 solve/игрок через
переиспользуемый `useSoloSession`) → экран результата + реванш. Полная обработка отвалов
(heartbeat, `opponent_left`, reconnect-снапшот, сервер-enforced phase-timeouts). Состояние комнаты
живёт в памяти процесса (single-worker, П6-6, без Redis). Честность = plumbing как в турнире:
`honesty=pending`, `time_ms` self-reported, без OpenCV (заблокирован R1). `solves` НЕ пишется —
PB-инвариант (§П5) не трогаем.

**Скептик вернул `revise` (2 HIGH + 6 MED); все впаяны в план ниже.** Ключевые правки против
наивного варианта: (1) П11 enforced через нормализованную `duel_participants` + partial-UNIQUE,
а НЕ через двухколоночный `begin_nested` (SAVEPOINT там не срабатывает); (2) WS-handshake
защищён Origin-allowlist + подписанным `session_token`, привязанным к `(room_id, user_id)` —
голого cookie недостаточно (CSWSH); (3) scramble на строке — plain-текст, без `scramble_token`/
nonce (мёртвая машинерия в этом кирпиче).

## Acceptance criteria
- Две вкладки / два аккаунта проводят полную дуэль Фаст от инвайт-ссылки до экрана результата;
  победитель — меньший валидный `time_ms`; valid > dnf; оба dnf → без победителя («ничья»);
  равные валидные времена → детерминированный тайбрейк по первому `finished_at`.
- `POST /duel/rooms`: authed → 201 (`room_id`, `invite_token`, `session_token`, `event`, `join_url`);
  anon → 401. Вторая активная дуэль того же `user_id` → 409 с `existing_room_id` (П11).
- `POST /duel/join/{token}`: второй authed игрок → занимает `player_b`, `status=full`; повторный
  вызов участником → идемпотентно тот же `room_id` (reconnect); третий чужой → 409; joiner с уже
  активной дуэлью → 409 (П11); неизвестный/просроченный token → 404.
- `GET /duel/rooms/{id}` (участник-only) отдаёт статус/фазу для bootstrap/reconnect — **БЕЗ scramble**.
- WS `/duel/ws/{room_id}`: коннект без валидного `session_token(room_id,user_id)` ИЛИ с чужим Origin →
  close (4401 / 4403); оба клиента получают ОДИН и тот же scramble в `start`; scramble отсутствует в
  любом REST-ответе; `status_update` соперника виден в реальном времени; оба `ready` → `countdown`
  с серверным `server_start_at` в будущем; оба `finish` → `result` с `winner_id`.
- Отвал: нет pong > `HEARTBEAT_TIMEOUT` → сопернику `opponent_left`; до старта таймера — grace
  `DISCONNECT_GRACE` → комната `abandoned`; во время сборки — не вернулся до solve-deadline →
  соперник побеждает (disconnect-DNF: у отвалившегося `status=dnf`, выживший выигрывает даже без
  сабмита времени).
- Reconnect по `session_token(room_id,user_id)` → полный `room_state`-снапшот: фаза, свой статус,
  статус соперника, scramble (если раскрыт), оставшиеся таймауты.
- Сервер enforce'ит: подготовка ≤ `PREP_TIMEOUT`(180с), сборка ≤ `SOLVE_TIMEOUT`(600с) → просрочка
  = DNF + финализация (userflow §5.4 / П6-5).
- Каждая попытка: `a_honesty/b_honesty` = `pending` всегда (никакого чтения как verdict); `time_ms`
  self-reported; ни кубки, ни рейтинг, ни `solves`, ни `best_single_ms` не затрагиваются.
- Реванш идемпотентен: keyed на `parent_room_id` (get-or-create) → ровно ОДНА дочерняя комната даже
  при двойном клике обоих игроков.
- `docs/ws-protocol.md` описывает все сообщения (направление/поля/триггер) + машину состояний +
  инварианты честности + явный out-of-scope.
- Прод refuse'ит multi-worker (assert `--workers 1` на старте) — in-memory RoomState не шарится.
- Все backend/frontend тесты зелёные; ruff/mypy(strict, scope)/tsc/lint чисто.

## Plan

### Backend — модель + миграция
- **`models/duel.py`** — `DuelRoom`: `id` GUID PK, `invite_token` String UNIQUE (`secrets.token_urlsafe`),
  `mode` ("fast"), `event` ("333"), `status` app-level (`open|full|active|finished|abandoned`),
  `scramble` String nullable (plain-текст, раскрывается при `active` — **без** token/nonce),
  `player_a_id` FK user NOT NULL, `player_b_id` FK user nullable, `a_time_ms/b_time_ms` Int nullable,
  `a_status/b_status` (`pending|valid|dnf`), `a_verify_frames_ok/b_verify_frames_ok` Bool nullable
  (сырой сигнал, **никогда** не читается как verdict — четырёхосевой контракт §П5),
  `a_honesty/b_honesty` String default `pending` (forward-compat plumbing, **никогда** не транзитится
  и не гейтит `winner_id`), `a_finished_at/b_finished_at` DateTime tz (для тайбрейка), `winner_id`
  GUID nullable (провизорный, honesty-агностичный), `parent_room_id` GUID nullable (реванш-линк),
  `created_at/finished_at`. Константы `DUEL_ROOM_STATUSES/DUEL_PLAYER_STATUSES/DUEL_HONESTY_STATES`
  + комментарии-инварианты по образцу `models/tournament.py`.
- **`models/duel_participant.py`** (HIGH#1 fix) — `DuelParticipant`: `user_id` FK, `room_id` FK CASCADE,
  `active` Bool. **Partial UNIQUE index на `user_id WHERE active`** (`postgresql_where` + sqlite partial
  index — тестируемо на обоих). Это, а не двухколоночный DuelRoom, физически enforce'ит «одна активная
  дуэль на user_id»: в двухколоночной схеме `begin_nested` SAVEPOINT НЕ срабатывает (нет integrity-
  нарушения при mirror-side). Строка ставится `active=false` при финализации/abandon.
- **`migrations/versions/0007_duel_rooms.py`** — create `duel_rooms` + `duel_participants` + индексы
  (invite_token unique, partial-unique participant, player_a/b, status). `down_revision=0006`,
  portable GUID как в `0005`.
- `models/__init__.py` — экспорт `DuelRoom`, `DuelParticipant`.

### Backend — схемы
- **`schemas/duel.py`** — REST: `DuelRoomCreateRead` (room_id, invite_token, session_token, mode,
  event, join_url), `DuelRoomRead` (room_id, status, mode, event, your_slot, opponent_present —
  **БЕЗ scramble**), `DuelJoinRead` (room_id, session_token, status). WS-входящие (`extra="forbid"`):
  `WsStatusUpdateIn` (phase Literal), `WsFinishIn` (time_ms int gt=0, dnf bool, verify_frames_ok bool).
  Исходящие сериализуются dict в роутере.

### Backend — сервисы
- **`services/duel_token.py`** — HMAC session/reconnect-токен (зеркало `scramble_token.py`):
  `sign(user_id, room_id, secret, ttl)` / `verify(token, secret) → VerifiedDuelSession(user_id, room_id)`.
  **Привязан к `(room_id, user_id)`** (MED fix: без user_id утёкший URL пускает третьего reconnect'иться
  как игрок). Отдельный `DUEL_SIGN_SECRET`.
- **`services/duel.py`** — DB-слой (чистые async-функции, транзакция у роутера):
  - `create_room(session, user_id)` — вставить participant(user, active) **внутри** транзакции; UNIQUE
    trips → reselect активной комнаты → 409 (П11 реально enforced). Иначе insert `DuelRoom(status=open,
    player_a)` + participant.
  - `join_room(session, invite_token, user_id)` — 404 нет комнаты; идемпотентно тот же room если уже
    участник (reconnect); participant-insert для joiner (UNIQUE → 409 П11); занять `player_b` guard
    `player_b_id IS NULL` (409 если занят третьим) + `status=full`.
  - `find_active_room(session, user_id)` — SELECT через participant (active) для П11/reconnect-редиректа.
  - `persist_scramble(session, room, scramble)` — при переходе в active записать **plain** scramble +
    `status=active`.
  - `finalize_room(session, room, ...)` — записать времена/статусы/`*_finished_at`, `winner=compute_winner`,
    `status=finished`, participant `active=false`. Идемпотентно (guard `status уже finished` — образец
    `sweep_expired_attempts`).
  - `abandon_room` — `status=abandoned`, participant `active=false`.
  - `rematch(session, parent_room_id, user_id)` — get-or-create дочерней комнаты keyed на
    `parent_room_id` (MED fix: двойной клик обоих → одна комната, не две → не ре-триггерит П11-баг).
  - **`compute_winner`** (чистая, тестируемая): меньший valid `time_ms` → тот игрок; valid > dnf;
    оба dnf **или** оба без результата → None (ничья); disconnect-DNF = у отвалившегося `dnf`, выживший
    выигрывает даже без сабмита; равные валидные времена → первый `finished_at` (детерминированный
    тайбрейк). `honesty` игнорируется полностью.
- **`services/duel_manager.py`** — in-memory ядро (single-worker). `ConnectionManager`: dict
  `room_id → RoomState`; `RoomState` держит `{player_id → WebSocket}`, per-player phase, scramble,
  `server_start_at`, результаты, дедлайны, `asyncio.Task` heartbeat + phase-timeout + countdown.
  Методы: `connect/disconnect/broadcast(exclude?)/send/snapshot(viewer_id)/set_status`
  (both_ready → countdown `server_start_at=now+COUNTDOWN`)/`record_finish` (оба done или дедлайн →
  finalize через колбэк с `AsyncSession`). Heartbeat: per-connection ping-таск, нет pong за timeout →
  disconnected → `opponent_left` + grace (до старта abandon; во время solve авто-победа). Phase-timeouts
  prep/solve → DNF + finalize. Все таски на `RoomState`, отмена при завершении/пустой комнате (тест на
  отсутствие утечки). **Все интервалы/таймауты инъектируемы** (тесты без реального sleep).
- **`services/ws_auth.py`** — WS cookie-JWT поверх существующего `auth_backend` (fastapi-users не даёт
  WS-dep): читает `websocket.cookies[COOKIE_NAME]`, `JWTStrategy.read_token` + user-manager. None →
  роутер close 4401. **HIGH#2: cookie сам по себе НЕ достаточен** — роутер дополнительно требует
  валидный `session_token(room_id,user_id)` и проверяет Origin-allowlist (иначе 4403, CSWSH-защита; WS
  не покрыт CORS/CSRF, в отличие от REST `_CSRF_COOKIE`).

### Backend — роутер + конфиг
- **`routers/duel.py`** — REST: `POST /duel/rooms` (create, `current_active_user`, ip-rate-limit),
  `GET /duel/rooms/{room_id}` (участник-only, БЕЗ scramble), `POST /duel/join/{invite_token}`
  (`current_active_user`), `POST /duel/rooms/{room_id}/rematch`. WS `/duel/ws/{room_id}`:
  Origin-allowlist → ws_auth cookie → verify `?token=`(room_id+user_id-binding) → регистрация в manager
  → `room_state`-снапшот → receive-loop (join/status_update/finish/ping → delegate). Переход в active
  (оба присутствуют) → `scramble=random_scramble()` (plain) → persist → `start` обоим. Финализация
  пишет в БД. Комментарий-инвариант: scramble раскрывается ТОЛЬКО через WS `start`, `honesty=pending`
  всегда, `solves` не трогается.
- `main.py` — `include_router(duel.router)`; **startup-assert refuse multi-worker** (MED fix).
- **`config.py`** — `DUEL_SIGN_SECRET` (min32 fail-closed + placeholder-guard, тот же валидатор, что
  `SCRAMBLE_SIGN_SECRET`), `DUEL_ALLOWED_WS_ORIGINS`, `DUEL_PREP_TIMEOUT_SECONDS=180`,
  `DUEL_SOLVE_TIMEOUT_SECONDS=600`, `DUEL_DISCONNECT_GRACE_SECONDS=60`,
  `DUEL_HEARTBEAT_INTERVAL_SECONDS=5`, `DUEL_HEARTBEAT_TIMEOUT_SECONDS=15`, `DUEL_COUNTDOWN_SECONDS=3`,
  `DUEL_INVITE_TTL_SECONDS`, `DUEL_RATE_LIMIT`.
- `.env.example` — плейсхолдеры новых `DUEL_*`.
- `tests/conftest.py` — экспорт `DuelRoom/DuelParticipant`; `DUEL_SIGN_SECRET` в `os.environ.setdefault`;
  sync-`TestClient` фикстура для WS-тестов (`AsyncClient` не умеет `websocket_connect`).

### Backend — протокол
- **`docs/ws-protocol.md`** — транспорт (`/api/duel/ws/{room_id}?token=`), auth (cookie+token+Origin),
  формат кадра. Таблица: C→S `join/status_update/finish/ping`; S→C `room_state/start(scramble,event,
  prep_deadline_at)/status_update(player,phase)/countdown(server_start_at)/result(players[],winner_id)/
  opponent_left(grace_seconds)/pong/error(code)`. Машина состояний комнаты + per-player фаз. Инварианты
  честности (self-reported, `honesty=pending`, `solves` не пишется) + out-of-scope + `--workers 1` note.

### Frontend
- **`api/duel.ts`** — `createRoom/getRoom/joinRoom/rematch` + `wsUrl(roomId, token)` (относительный,
  cookie едет same-origin proxy).
- **`duel/duelMachine.ts`** — reducer (образец `useTournamentAttempt.ts`): `connecting → waiting_opponent
  → preparing → ready_wait → countdown → solving → finished → result` + error-фазы `duel_already_active`
  (несёт `existing_room_id`), `opponent_left`, `disconnected`, `room_not_found`. Держит: своя фаза,
  статус соперника, scramble, server_start_at, свой/чужой результат, winner.
- **`duel/useDuelSocket.ts`** — WS-клиент: connect, парсинг → dispatch, отправка status_update/finish/ping,
  heartbeat-ping, auto-reconnect backoff по `room_id+session_token` (шлёт join для снапшота), idempotent
  close на unmount (StrictMode-safe, паттерн `useSoloSession`-cleanup).
- **`duel/DuelRoom.tsx`** — панель статуса соперника + встроенный ритуал через
  `useSoloSession({ fixedScramble: scramble, onResult: (r) => socket.sendFinish(r) })` **БЕЗ форка**.
  Countdown-оверлей поверх камеры до `server_start_at`. `status_update` на переходах фазы ритуала.
  Error-фазы (`duel_already_active` → кнопка reconnect; `opponent_left` → баннер).
- **`duel/DuelResult.tsx`** — время обоих, победитель / «ничья», кнопка «Реванш» (→ `rematch`).
  Кубки/рейтинг НЕ показываем.
- **`duel/InvitePanel.tsx`** — `join_url` + «Скопировать ссылку» + «ждём соперника».
- **`pages/DuelPage.tsx`** — `/duel/:roomId` (ProtectedRoute): bootstrap `getRoom` + `useDuelSocket` +
  `DuelRoom/DuelResult` по фазе.
- **`pages/DuelJoinPage.tsx`** — `/duel/join/:token` (ProtectedRoute, anon → login с return-to →
  `joinRoom` → navigate `/duel/:roomId`). 404/409 обработка.
- `pages/HomePage.tsx` — кнопка «Дуэль по ссылке» → `createRoom` → navigate + InvitePanel.
- `App.tsx` — роуты `/duel/:roomId`, `/duel/join/:token` (оба ProtectedRoute).
- `vite.config.ts` — `proxy["/api"].ws = true` (проверить, что апгрейд не ломает HTTP-роут).
- `auth/ProtectedRoute.tsx` — return-to при anon-редиректе (проверить; если уже есть — no-op).

## Test plan
Полное покрытие. haiku-тест-агент пишет ровно эти тесты.

### Backend — `tests/test_duel_token.py`
- `sign → verify` возвращает `(user_id, room_id)`; подмена подписи → `DuelTokenError`; истёкший `exp`
  → error; verify с чужим `room_id` не матчит; verify с чужим `user_id` не матчит.

### Backend — `tests/test_duel.py` (REST + сервис)
- `compute_winner`: `a<b` валидные → a; valid vs dnf → valid; оба dnf → None; оба без результата →
  None; disconnect-DNF (соперник dnf, я без времени) → я; равные валидные времена → первый
  `finished_at` (детерминированно).
- `create_room`: authed → 201 (room_id/invite_token/session_token); anon → 401.
- **П11 create**: второй create тем же user при open/full/active → 409 + `existing_room_id`; после
  finished/abandoned (participant `active=false`) → новый create проходит. **Проверить, что partial-
  UNIQUE реально ловит** (вставка второго active-participant → IntegrityError → reselect).
- `join`: второй user по invite_token → player_b + `status=full`; повторный join участником →
  идемпотентно тот же room_id; третий чужой → 409; неизвестный/просроченный token → 404.
- **П11 join**: user с активной комнатой пытается join другую → 409.
- `rematch`: двойной вызов (оба игрока) keyed на `parent_room_id` → ОДНА дочерняя комната (идемпотентно).
- **PB-инвариант (§П5)**: полная дуэль создаёт **ноль** строк `solves`, `best_single_ms` и `GET /solves`
  не изменились.

### Backend — `tests/test_duel_manager.py` (unit, инъекция коротких таймаутов)
- `ConnectionManager`: connect/disconnect/broadcast/exclude/send/snapshot.
- both_ready → countdown с `server_start_at` в будущем.
- record_finish: оба done → finalize; дедлайн без finish → DNF + finalize.
- opponent_left: disconnect до старта → grace-истечение → `abandoned`; disconnect во время solve → не
  вернулся до solve-deadline → соперник побеждает (disconnect-DNF).
- phase-timeouts: prep-deadline без ready → DNF+finalize; solve-deadline без finish → DNF+finalize.
- heartbeat: нет pong > timeout → игрок disconnected, сопернику opponent_left.
- пустая комната → очистка RoomState + отмена ВСЕХ asyncio-тасков (нет утечки).
- финализация идемпотентна (повторный вызов на `finished` — no-op).

### Backend — `tests/test_duel_ws.py` (sync TestClient + in-memory sqlite)
- WS auth: коннект без cookie → close 4401; с валидным cookie но чужим Origin → close 4403; валидный
  cookie + token(room_id,user_id) + Origin → `room_state`-снапшот.
- shared scramble: оба клиента получают `start` с ИДЕНТИЧНЫМ scramble; scramble отсутствует в
  `GET /duel/rooms/{id}`.
- status_update: A шлёт ready → B получает `status_update(opponent, ready)`; оба ready → обоим `countdown`.
- finish/result: оба валидных → `result` winner = меньший time_ms; A valid + B dnf → winner=A; оба dnf
  → `winner_id=null`.
- reconnect: после disconnect повторный WS с тем же `session_token` → `room_state` со scramble (если
  раскрыт), своим/чужим статусом, оставшимся таймаутом.

### Frontend
- `duel/duelMachine.test.ts` — все переходы reducer'а: `connecting→…→result`; `opponent_left`;
  `duel_already_active` несёт `existing_room_id`; `disconnected→reconnect` восстанавливает из room_state.
- `duel/useDuelSocket.test.ts` (mock WebSocket) — входящее `start` → dispatch со scramble; heartbeat-ping
  по интервалу; обрыв → reconnect шлёт join; unmount → close идемпотентно.
- `duel/DuelRoom.test.tsx` (RTL) — панель статуса соперника; countdown-оверлей виден до `server_start_at`
  и снят после; error-фаза `duel_already_active` рендерит кнопку reconnect.
- `pages/DuelJoinPage.test.tsx` — anon → редирект `/login` с return-to; 409 → кнопка перейти в
  существующую комнату.

## Blockers
Открытых HIGH нет — оба скептических HIGH разрешены в плане (П11 через `duel_participants` + partial-
UNIQUE; CSWSH через Origin-allowlist + `(room_id,user_id)`-token). Одно решение стоит подтвердить у
человека перед /build:
- **П11 — participant-table vs pg advisory-lock.** План выбрал нормализованную `duel_participants` +
  partial-UNIQUE (робастно, тестируемо на sqlite, переживает multi-worker если он появится). Альтернатива —
  `pg_advisory_xact_lock(hash(user_id))` (без новой таблицы, но no-op на sqlite → race-тест непроверяем
  и не готов к multi-worker). Рекомендация: participant-table. Подтвердить или переопределить.

## Out of scope
- Матчмейкинг/очередь по режиму+диапазону кубков, расширение диапазона (Этап 4.2).
- Режим «риск».
- Ao5 (5 сборок, WCA-average) — сейчас только Фаст = 1 solve/игрок.
- Начисление кубков, рейтинг, ranked-гейт на `validated && honesty=="verified"`.
- OpenCV-перечитка кадров / событийный анти-чит-арбитраж (П5.1-3) — заблокирован R1/камерой; honesty
  остаётся `pending`, `time_ms` self-reported.
- Redis/multi-worker шэринг RoomState — MVP на памяти одного воркера (startup refuse'ит `--workers N`).
- Полный accept/30-сек-таймаут реванша и «новый соперник → матчмейкинг» из userflow §5.3 (упрощён до
  идемпотентной кнопки).
- Мобильная поддержка/заглушка, аналитика воронки дуэлей.
- `scramble_token`/nonce для дуэли — не пишем (scramble на строке plain-текстом; token-machinery
  вернём, если появится проводка дуэли в `/solves`).

## Assumptions
- `solves` НЕ пишется; результаты дуэли живут на строке `DuelRoom` — хватает для экрана результата и
  reconnect-снапшота. PB-инвариант §П5 не трогаем (есть тест).
- Инвайт одноразово-на-заполнение: после занятия `player_b` повторный join не-участником отклоняется;
  TTL = `DUEL_INVITE_TTL`.
- `random_scramble()` (random-MOVE, не WCA random-STATE) переиспользуется как есть — тот же MVP-
  компромисс, что в турнире/соло.
- Фазы дуэли выведены из userflow §5.1/§5.4 + П6, зафиксированы в `ws-protocol.md` как источник истины.
- Синхронный старт = серверный сигнал `countdown/server_start_at` гейтит старт на уровне человека
  (оверлей поверх камеры), НЕ подменяет источник времени. Истинный ms-lockstep не гарантируется —
  время self-reported (`honesty=pending`, как в турнире). Событийный серверный арбитраж (П5.1-3) —
  явно вне скоупа (заблокирован R1).
- ProtectedRoute уже умеет (или тривиально доучивается) сохранять return-to для `/duel/join/<token>`.
