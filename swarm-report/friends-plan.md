# Plan: Друзья и подписки (slug: friends)

Merged from `planner` + `skeptic` (opus, parallel). Skeptic verdict on the draft: **revise**
(8 HIGH, 5 MED, 2 LOW). HIGH/MED fixes are folded in below. The 4 remaining HIGH judgment
calls were escalated (user unavailable) and resolved by the coordinator on 2026-08-18 —
see **Decisions**. Plan is approved; no open Blockers.

## TL;DR

Взаимные друзья по `public_handle` (никакого поиска по email/нику) плюс кнопка «Вызвать» из
списка друзей, создающая комнату дуэли существующим механизмом и отдающая ссылку для ручной
отправки — без обмана про пуш-уведомление, которого нет. Модель дружбы — одна строка на пару
через **упорядоченную пару** `(user_low_id, user_high_id)` с `CHECK`+`UNIQUE` в БД, что физически
исключает дубль A→B/B→A и дружбу с самим собой. Наружу — только `public_handle` (или «Аноним»)
и `friendship_id`; никогда email/nickname/user UUID. `public_handle` становится
**регистронезависимо уникальным** (сейчас не уникален вообще — обязательная правка существующей
таблицы `user`, иначе «добавить по хэндлу» неоднозначно).

## Acceptance criteria

- A вводит `public_handle` B на `/profile` → заявка видна у B во «Входящих», у A в «Исходящих»;
  после «Принять» оба видят друг друга в `GET /friends`.
- Ни один ответ `/friends/*` не содержит `email`, `nickname` или UUID пользователя — только
  `friendship_id`, `display_name` (`public_handle` или «Аноним»), таймстампы.
- Поиска людей по email/nickname нет ни в одном эндпоинте и ни в одном параметре.
- Заявка самому себе → 422; заявка без своего установленного `public_handle` → 403
  `HANDLE_REQUIRED`.
- Принять можно только заявку, адресованную тебе: чужая ИЛИ несуществующая заявка → **один и тот
  же** 404 (по `friendship_id` нельзя выяснить, чья это строка и существует ли она).
- Заявку можно отменить (отправитель) и отклонить (получатель) — строка удаляется, повторная
  заявка снова возможна. Друга можно удалить — то же самое.
- Аноним → 401 на всех эндпоинтах `/friends/*`.
- Пара (A,B)/(B,A) физически не даёт двух строк: прямая вставка зеркальной пары в обход сервиса
  падает `IntegrityError` на уровне БД, не на проверке в коде.
- Заявка по существующему, но занятому кем-то другим сценарию (уже pending / уже друзья) не
  создаёт вторую строку — прогнано через `session.begin_nested()` + перехват `IntegrityError`
  (тот же приём, что `duel.create_room`), не через pre-check (TOCTOU).
- Заявка по несуществующему/чужому/уже-занятому хэндлу защищена от перебора **рейт-лимитом,
  ключованным по `user.id` вызывающего** (не по IP — эндпоинт authed, IP-лимит для него не
  защита), плюс `public_handle` теперь проиндексирован и уникален (без индекса — full scan на
  каждый запрос).
- Кнопка «Вызвать» создаёт комнату дуэли существующим `POST /duel/rooms`; если у вызывающего уже
  есть активная комната (П11, 409) — интерфейс НЕ падает и предлагает перейти в неё, а не тратит
  впустую ещё одну попытку.
- `alembic upgrade head` / `downgrade -1` / `upgrade head` на новой миграции проходят чисто на
  Postgres.
- `pnpm build` + `node scripts/check-bundle.mjs`: входной чанк остаётся в бюджете; **если рост
  вызван статически импортируемым `i18n/en.ts`, а не самим кодом друзей — это отдельно измеряется
  и явно решается, порог не поднимаем** (см. Test plan/риски).
- Backend `pytest` и frontend `pnpm test` зелёные целиком.

## Plan

### Backend — модель и миграция

1. `backend/app/models/friendship.py` — новый. `Friendship`: `id` (GUID PK),
   `user_low_id`/`user_high_id` (GUID FK `user.id` ON DELETE CASCADE), `requested_by_id` (GUID FK
   `user.id` ON DELETE CASCADE), `status` String(16) ∈ {"pending","accepted"}, `created_at`,
   `responded_at` (nullable). `__table_args__`:
   - `UniqueConstraint("user_low_id","user_high_id")` — одна строка на пару.
   - `CheckConstraint("user_low_id < user_high_id")` — упорядоченность И одновременно запрет
     дружбы с самим собой (строгое «меньше»).
   - `CheckConstraint("requested_by_id = user_low_id OR requested_by_id = user_high_id")`.
   - `CheckConstraint("status IN ('pending','accepted')")`.
   - Индексы по `user_low_id`, `user_high_id` для списков.
   Докстринг фиксирует: порядок пары считается в Python через `sorted((a, b))` на `uuid.UUID`
   (сравнение по целому значению); совпадает и с Postgres `uuid` (побайтово), и со sqlite
   `GUID`-типом (hex-строка без дефисов, лексикографически) — если тип колонки когда-нибудь
   сменится, инвариант нужно перепроверить явно.
2. `backend/app/models/user.py` — добавить `__table_args__` с уникальным индексом:
   `Index("uq_user_public_handle_lower", func.lower(public_handle), unique=True,
   postgresql_where=public_handle.isnot(None), sqlite_where=public_handle.isnot(None))`.
   **NULL-безопасность (coordinator sign-off):** индекс частичный (`WHERE public_handle IS NOT
   NULL`) именно затем, чтобы второй и последующие пользователи без хэндла (`NULL`) не
   конфликтовали друг с другом — SQL `UNIQUE` по умолчанию не считает `NULL == NULL`, а частичный
   индекс дополнительно гарантирует, что пустые хэндлы вообще не попадают в проверяемое множество.
   Комментарий в коде: НЕ делает профиль публичным, хэндл по-прежнему opt-in/пуст по умолчанию —
   просто делает «добавить по хэндлу» однозначным.
3. `backend/app/models/__init__.py` — импорт + `__all__` для `Friendship`.
4. `backend/migrations/versions/0011_friendships.py` — новая, hand-written,
   `down_revision = "0010_profile_showcase"` (в стиле 0007/0010). `upgrade()`: `create_table` со
   всеми constraints, два индекса, затем уникальный индекс по `lower(public_handle)`.
   `downgrade()`: строго обратный порядок. **В докстринге — обязательная SQL-проверка на
   существующие дубли хэндлов (без учёта регистра) перед накатом на живую базу** — без неё
   `upgrade` падает, если дубль уже есть.

### Backend — сервис, схемы, роутер

5. `backend/app/schemas/friend.py` — новый: `FriendRequestCreate {public_handle: str}` (trim,
   min_length=1, max_length=64), `FriendRead {friendship_id, display_name, since}`,
   `FriendRequestRead {friendship_id, display_name, created_at}`. Докстринг модуля буквально
   повторяет: ни email, ни nickname, ни user id тут не появится.
6. `backend/app/services/friends.py` — новый.
   - `pair_key(a, b) -> tuple[UUID, UUID]` = `tuple(sorted((a, b)))`.
   - `send_request(session, requester, handle)`: регистронезависимый поиск
     `func.lower(User.public_handle) == handle.strip().lower()` при `is_active`; handle не найден
     → `FriendNotFoundError`; сам себе → `FriendSelfError`; у requester нет своего
     `public_handle` → `FriendHandleRequiredError`; вставка внутри `session.begin_nested()`,
     `IntegrityError` → re-SELECT существующей строки → `FriendConflictError("PENDING"|
     "FRIENDS")`; **встречная заявка (B уже подал A) авто-принимается** — согласие уже выражено
     обеими сторонами, лишний клик не нужен.
   - `list_friends`, `list_incoming`, `list_outgoing`, `accept`, `delete_request`,
     `remove_friend`. `accept` требует `status=="pending"`, вызывающий в паре И
     `requested_by_id != caller` — любое несовпадение → `FriendNotFoundError` (единый 404, чужую
     заявку от несуществующей не отличить).
   - `display_name` — переиспользовать `app.services.tournament.display_name_for` (не заводить
     второй источник «Анонима»).
7. `backend/app/routers/friends.py` — новый. `APIRouter(prefix="/friends")`, все ручки
   `Depends(current_active_user)` (аноним → 401). Ручки:
   `POST /friends/requests`, `GET /friends`, `GET /friends/requests/incoming`,
   `GET /friends/requests/outgoing`, `POST /friends/requests/{friendship_id}/accept`,
   `DELETE /friends/requests/{friendship_id}` (отклонить входящую ИЛИ отменить исходящую — одна
   ручка), `DELETE /friends/{friendship_id}`.
   **Рейт-лимит на `POST /friends/requests` — по `user.id`, не по IP** (skeptic HIGH: IP-лимит на
   authed-эндпоинте не защита от перебора хэндлов — ротация IP/второй воркер его обнуляет). Новая
   зависимость в `ratelimit.py`, `user_rate_limit(limit)`, зеркалящая форму
   `login_account_rate_limit` (ключ `f"friend-request:{user.id}"`, "hit on every request" —
   каждая попытка тратит бюджет, успех не освобождает, в отличие от login-исключения). Остальные
   ручки — обычный `ip_rate_limit(FRIENDS_RATE_LIMIT)` по образцу duel.py.
   Маппинг исключений: `FriendNotFoundError`→404, `FriendSelfError`→422,
   `FriendHandleRequiredError`→403 `{"code":"HANDLE_REQUIRED"}`,
   `FriendConflictError`→409 `{"code": "FRIEND_ALREADY_" + reason}`.
8. `backend/app/services/auth.py` — в `UserManager.update()` **до** вызова `super().update()`
   добавить регистронезависимую пре-проверку занятости `public_handle` (та же дисциплина, что у
   `_reject_bad_names`/фильтра ников — человеческое сообщение вместо голой ошибки БД): SELECT
   существующего пользователя с `func.lower(User.public_handle) == new_value.strip().lower()`
   и `id != self`; найден → `HTTPException(400, {"code": "HANDLE_TAKEN", "reason": ...})` тем же
   `detail: {code, reason}`-диалектом, что и CUBE_LIMIT/NAME_*. Уникальный индекс из п.2 остаётся
   race-guard'ом на случай двух параллельных PATCH — на этот путь (гонка, не обычный ввод)
   отдельно перехватывается `IntegrityError` вокруг `super().update()` и мапится в тот же
   `HANDLE_TAKEN`, а не в 500.
9. `backend/app/config.py` — `FRIENDS_RATE_LIMIT: str = "60/minute"`,
   `FRIEND_REQUEST_RATE_LIMIT: str = "10/minute"`. `backend/.env.example` — те же две строки
   (`test_env_example.py` падает при рассинхроне).
10. `backend/app/main.py` — `app.include_router(friends.router)`.

### Frontend

11. `frontend/src/api/friends.ts` — новый: типы + `listFriends/listIncoming/listOutgoing/
    sendRequest/acceptRequest/deleteRequest/removeFriend` через `api/client.ts`. Комментарий:
    `friendship_id` — id строки дружбы, намеренно не user id.
12. `frontend/src/friends/FriendsSection.tsx` — новый: список друзей (кнопки «Вызвать»/
    «Удалить»), входящие («Принять»/«Отклонить»), исходящие («Отменить»), форма добавления по
    хэндлу с обработкой 404/403/409. Все строки через `useT()`.
13. `frontend/src/friends/useChallengeFriend.ts` — новый: `createRoom()` из `api/duel.ts` →
    `navigate("/duel/"+room_id, {state:{joinUrl}})`. На 409 (П11 — уже есть активная комната) —
    достаёт id существующей комнаты из тела ошибки и предлагает переход в неё вместо падения.
14. `frontend/src/duel/InvitePanel.tsx` — одна строка копии: «Уведомление не придёт — отправь
    ссылку сам» (через `t()`), без новой логики.
15. `frontend/src/pages/ProfilePage.tsx` — вставить `<FriendsSection />`. `ProfilePage` уже под
    `lazy()` в `App.tsx` — новый код едет в её чанк, отдельный роут/split не нужен.
16. `frontend/src/api/client.ts` — русская копия для `HANDLE_TAKEN`, `FRIEND_ALREADY_PENDING`,
    `FRIEND_ALREADY_FRIENDS`, `HANDLE_REQUIRED` в `RU_BY_CODE`.
17. `frontend/src/i18n/en.ts` — переводы всех новых строк (ключ = русская строка); проверяется
    существующим `tests/i18n/coverage.test.ts`.

### Тесты, инфраструктура

18. `backend/tests/conftest.py` — `Friendship` в импорт + `Base.metadata.create_all`.
19. `backend/tests/test_friends.py`, дополнение `test_profile_names.py`, новый
    `test_migrations.py` — см. Test plan.
20. `frontend/tests/friends/FriendsSection.test.tsx`, `frontend/tests/api/friends.test.ts`.
21. Замер бюджета: `pnpm build` + `node scripts/check-bundle.mjs` ДО и ПОСЛЕ. `en.ts`
    импортируется статически (`i18n/t.ts`), значит новые строки летят во входной чанк независимо
    от того, что сам `FriendsSection` ленивый — это НЕ то же самое, что "экран ленивый, значит
    бюджет не тронут". Если после добавления строк входной чанк вылезает за бюджет — по правилу
    проекта порог не поднимаем; делить придётся сам `en.ts`/локали по маршрутам с динамическим
    импортом. Фиксируется как обязательный шаг /build, а не предположение.
22. Ручная проверка миграции: Postgres, `alembic upgrade head` → `downgrade -1` →
    `upgrade head`, результат — в отчёт /build.
23. `.memory-bank/tasks/README.md` — отдельная строка «известный хвост»: orphaned-room lockout
    (Decision #4), с точным адресом (`app/services/duel.py::find_active_room` не учитывает
    TTL/статус `open`; `DELETE /duel/rooms/{id}` не существует) и пометкой, что это pre-existing
    баг сервиса дуэлей, не привнесённый фичей друзей.

## Test plan

Backend (`backend/tests/test_friends.py`, если не указано иное):

- `test_request_accept_then_both_see_friend` — happy path: заявка по хэндлу → видна в
  incoming/outgoing → принятие → у обоих одна запись в `GET /friends`.
- `test_request_to_self_rejected` — 422, в БД ни одной строки.
- `test_request_without_own_handle_403` — у requester пуст `public_handle` → 403
  `HANDLE_REQUIRED`, строка не создаётся.
- `test_duplicate_request_conflicts` — повторная заявка на pending → 409
  `FRIEND_ALREADY_PENDING`; после принятия → 409 `FRIEND_ALREADY_FRIENDS`; строка в таблице
  всегда одна.
- `test_reverse_request_auto_accepts` — B→A, затем A→B: ответ `status=="accepted"`, строка одна.
- `test_accept_someone_elses_request_404` — третий пользователь C и сам отправитель B получают
  404 на попытку принять чужую/свою исходящую заявку; статус остаётся `pending`.
- `test_accept_unknown_friendship_id_404` — случайный UUID даёт **тот же** 404 (тело
  неотличимо от "чужая заявка").
- `test_double_accept_is_idempotent_404` — повторный accept уже принятой заявки → 404 (запись
  уже не `pending`), не 500 и не тихий успех.
- `test_decline_and_cancel_request` — получатель отклоняет входящую (204, обе стороны пусты);
  отправитель отменяет исходящую (204); в обоих случаях заявку можно подать заново.
- `test_remove_friend` — удаление друга → `GET /friends` пуст у обоих, строка удалена, повторная
  заявка снова проходит.
- `test_friend_list_has_no_pii` — аналог `test_daily.py::test_board_valid_entry_deranked_no_pii`:
  без хэндла → `display_name=="Аноним"`; ни в одном из ЧЕТЫРЁХ list-эндпоинтов
  (`/friends`, `/friends/requests/incoming`, `/friends/requests/outgoing` с обеих сторон) нет
  ключей `email`/`nickname`/`user_id`/`id` пользователя и нет самой строки email/UUID в
  сериализованном ответе.
- `test_unknown_public_handle_404` — заявка на несуществующий хэндл → 404; регистр не важен
  (заявка на `"SPEEDCUBER"` находит `"speedcuber"`).
- `test_anon_gets_401_on_every_endpoint` — параметризовано по всем 7 (метод, путь).
- `test_pair_row_is_order_independent` — прямая вставка зеркальной пары в обход сервиса →
  `IntegrityError`; отдельно — вставка с `user_low_id==user_high_id` → тоже `IntegrityError`
  (дружба с собой невозможна на уровне БД, не только в коде).
- `test_incoming_and_outgoing_are_disjoint` — заявка видна ровно в одном списке на каждой
  стороне; после принятия исчезает из обоих списков заявок.
- `test_friend_request_rate_limited_per_user` — N+1-я заявка от одного `user.id` за короткое
  окно → 429, независимо от смены IP (мок/фикстура двух разных `request.client.host` с одним и
  тем же куки-юзером всё равно триггерит лимит).
- `test_profile_names.py::test_public_handle_unique_case_insensitive` — второй пользователь
  PATCH на тот же хэндл в другом регистре → `HANDLE_TAKEN`, не 500, хэндл в БД не меняется.
- `test_migrations.py::test_upgrade_downgrade_upgrade` — против `MIGRATION_TEST_DATABASE_URL`
  (Postgres); без переменной — `pytest.mark.skip` с причиной (существующая цепочка миграций уже
  не идёт на sqlite из-за 0007).

Frontend (`frontend/tests/friends/FriendsSection.test.tsx`, если не указано иное):

- «показывает друзей и Анонима» — пустой `display_name` рендерится как «Аноним».
- «добавление по хэндлу» — сабмит вызывает `sendRequest`; 404 → «Такого хэндла нет», 403 →
  подсказка задать свой хэндл, 409 → «уже отправлено/уже друзья»; форма не очищается при ошибке.
- «принять и отклонить входящую» — клики вызывают `acceptRequest`/`deleteRequest` с верным
  `friendship_id`, запись переносится/исчезает.
- «удаление друга» — `removeFriend` с верным `friendship_id`.
- «вызов в один клик» — клик вызывает `createRoom`, `navigate` на `/duel/<room_id>` с `joinUrl`
  в state; отдельный кейс — 409 от `createRoom` не роняет компонент, показывает переход в
  существующую комнату.
- «в разметке нет PII» — при моках без email/uuid `container.textContent` не содержит `@` и не
  содержит подстрок, похожих на UUID (регресс-сторож на «случайно вывели user_id»).
- `tests/api/friends.test.ts` — каждая функция бьёт ожидаемый путь/метод,
  `friendship_id` через `encodeURIComponent`.
- `tests/i18n/coverage.test.ts` (существующий) остаётся зелёным — все новые строки переведены.

## Decisions (эскалированы, пользователь недоступна — решил координатор, 2026-08-18)

Все четыре — утверждение плана координатором вместо пользователя (не молчаливое допущение).

1. **Оракул перечисления через разные коды ответа — коды НЕ унифицируются.** `404`/`409`/`409`
   остаются наблюдаемыми, вместо skeptic-предложенного единого `202`. **Причина, не просто
   решение:** `public_handle` — поле, которое человек делает публичным сам, и оно уже показывается
   всем на бордах турнира/дня — «такой хэндл существует» не новая информация, это то же самое,
   что и так видно на борде. Утечкой была бы только точка, где приватная информация (email, ник)
   становится наблюдаемой — там ответ обязан быть неразличимым, здесь этого нет. Единственная
   сохранённая митигация — **per-user рейт-лимит** (п.7, `test_friend_request_rate_limited_per_user`)
   против массового перебора; он остаётся, потому что решает отдельную задачу (дороговизна
   перебора), а не задачу «скрыть публичный факт».
2. **«Вызов в один клик» строится, но без изображения того, чего нет.** Согласие с skeptic:
   реальной дельты к R5 через доставку нет — кнопка создаёт комнату и даёт готовую ссылку с
   подписью «отправь её сам» (см. п.13/14, `InvitePanel`). Персистентный «входящий вызов»,
   который решал бы доставку по-настоящему, сознательно **не строится** в этой задаче. Ценность
   кнопки — экономия ручных кликов (не собирать ссылку заново из общего экрана дуэли, а нажать
   рядом с конкретным именем в списке друзей), не уведомление. Отчёт `/build` обязан прямо
   написать, что персистентного вызова нет и почему.
3. **Отдельная ссылка-приглашение в друзья — не делаем.** Skeptic прав по обоим рогам дилеммы:
   авто-дружба по ссылке ломает «только взаимное согласие» (переслал в чат — все подружились без
   спроса), а неавто-дружба по ссылке — та же заявка, что и по хэндлу, просто с лишней сущностью
   (токен, таблица, роут) без новой ценности. Единственный путь добавления — `public_handle`.
   Зафиксировано в Out of scope.
4. **Orphaned-room lockout (П11) — не чиним в этом PR, но не прячем.** Существующий баг сервиса
   дуэлей (`find_active_room` не учитывает TTL/`open`-статус, `DELETE /duel/rooms/{id}` не
   существует), не привнесённый этой фичей. Фронтовое смягчение (409 → переход в существующую
   комнату, п.13) остаётся в плане. Дополнительный шаг: запись в
   `.memory-bank/tasks/README.md` как известный хвост с точным указанием, где он живёт
   (`app/services/duel.py::find_active_room`, отсутствие `DELETE /duel/rooms/{id}`) — делается
   на шаге /build, до PR, чтобы не потерялось.

## Out of scope

- Блокировка пользователей (чёрный список) — отдельная задача. Отклонение/удаление физически
  удаляют строку, повторная заявка снова возможна сразу — никакого кулдауна не строим (skeptic
  MED предлагал `rejected_at` + cooldown; сознательно не берём, чтобы не наращивать скоуп рядом с
  явно вынесенной блокировкой — тот же класс проблемы, то же решение «отдельная задача»).
- Поиск людей по email/nickname — не будет ни в каком виде.
- Публичная страница профиля / любые публичные поля, кроме `public_handle`.
- Email/пуш-уведомления о заявке, принятии, вызове на дуэль.
- Лента активности друзей, рейтинг среди друзей, доска друзей, «друзья друзей», импорт контактов.
- Лимит на число друзей/исходящих заявок (есть только рейт-лимит по времени).
- Онлайн-статус/presence — отдельный приватностный разговор.
- Отдельная ссылка-приглашение в друзья (Decision #3) — используется только `public_handle`.
- Починка `find_active_room`/`DELETE /duel/rooms` (Decision #4) — известный хвост, заводится в
  `.memory-bank/tasks/README.md`, не чинится в этом PR.

## Assumptions

- Наружу отдаётся `friendship_id` (id строки дружбы) как единственный небазовый идентификатор —
  это не user id и не идентифицирует человека вне контекста конкретной пары, поэтому не читается
  как нарушение «никогда UUID пользователя». Кнопка «Вызвать» не нуждается в UUID друга вообще —
  создаёт свою комнату и отдаёт ссылку.
- Встречная заявка (B→A, затем A→B) трактуется как обоюдное согласие и авто-принимается, а не
  601 «сначала прими входящую».
- Раздел «Друзья» — секция внутри `ProfilePage`, не отдельный роут; ленивость уже даёт `lazy()`
  в `App.tsx`.
- Тест на upgrade/downgrade миграции требует живого Postgres (существующая цепочка миграций уже
  не проходит на sqlite из-за 0007) — по умолчанию skip без переменной окружения, живая проверка
  — отдельный ручной шаг /build.
- `public_handle`, попадая под уникальный индекс, — правка уже существующей таблицы `user`, а не
  только новой фичи; проект ещё не задеплоен на прод, но перед накатом на любую базу с данными
  нужна ручная SQL-проверка на дубли (в докстринге миграции).
