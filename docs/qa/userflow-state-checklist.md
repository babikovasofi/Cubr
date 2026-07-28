# Чеклист состояний userflow §10 — где закрыто и чем доказано

Прогон перед деплоем: каждый пункт §10 «Состояния, которые легко забыть» сведён
к месту в коде и к тесту. Где теста не было — он дописан, где дыра — закрыта.

Дата прогона: 2026-07-28.

## 1. Пустые состояния

| Состояние | Где | Доказательство |
| --- | --- | --- |
| История сборок пуста | `ProfilePage` — карточка «Пока нет сохранённых сборок» + ссылка в соло | `tests/pages/ProfilePage.test.tsx` (добавлен) |
| Данных для графика мало | `SolveProgressChart` — placeholder вместо пустой оси | `tests/profile/SolveProgressChart.test.tsx` |
| Борд недели / дня пуст | `TournamentStandings`, `DailyBoard` — «Пока никто не закончил» | `tests/tournament/TournamentStandings.test.tsx`, `tests/daily/DailyBoard.test.tsx` |
| Серии нет | `StreakBadge` — «Серии пока нет» / «Серия прервалась» | `tests/daily/StreakBadge.test.tsx` |
| Никого онлайн для матчмейкинга | **неприменимо**: матчмейкинга нет by design, дуэль только по ссылке (R5) | — |

## 2. Загрузка и ожидание

| Состояние | Где |
| --- | --- |
| Загрузка состояния дня/недели | `DailyPage` / `TournamentPage` — `Spinner` на фазах `loading`/`committing`/`submitting` |
| Ожидание соперника | `DuelRoom` — фаза `waiting` + ссылка-приглашение |
| «Соперник ещё собирает» | `DuelRoom` — статус слота соперника из WS-снапшота |
| Валидация кадров сервером | **не существует**: серверной перепроверки кадров нет (Этап 3 заблокирован), и правила/лендинг об этом говорят прямо |

## 3. Ошибки сети

| Состояние | Где | Доказательство |
| --- | --- | --- |
| WS отвалился → реконнект со снапшотом | `useDuelSocket` + `ConnectionManager` (снапшот при подключении, heartbeat 10с/разрыв 15с) | `tests/duel/useDuelSocket.test.ts`, backend `tests/test_duel_ws.py` |
| Бэкенд лежит (502/503/504) | `api/client.ts` — отдельные тексты по статусу вместо общего «что-то пошло не так» | `tests/api/client.test.ts` |
| Сеть пропала (fetch упал) | `api/client.ts` → `ApiError(0)` «Проверь интернет» | там же |
| Сессия истекла посреди ритуала | `useDailyAttempt` / `useTournamentAttempt` — `submitErrorKind="unauthorized"`, результат не теряется, есть повтор | `tests/daily/useDailyAttempt.test.ts`, `tests/tournament/useTournamentAttempt.test.ts` |

## 4. Камера

`useCamera.mapGetUserMediaError` разводит `NotAllowedError`/`SecurityError` →
`denied`, `NotFoundError`/`OverconstrainedError` → `not-found`,
`NotReadableError`/`AbortError` → `in-use`, плюс `insecure` (не-https) и
`unsupported` (нет `getUserMedia`). Тексты — `vision/cameraErrors.ts`, каждый
объясняет, что чинить.

Доказательство: `tests/vision/cameraErrors.test.ts` (добавлен) — в том числе
проверка, что тексты **различаются**, а не сводятся к общему.

Трек «умер» посреди сессии (камеру забрало другое приложение, ушёл в сон) —
`onLost` сбрасывает «запущено» и предлагает старт заново.

## 5. Мобильный браузер

Закрыт отдельной фичей: `DesktopOnlyGate` на ритуальных роутах, лендинг/правила/
приватность/вход открыты. См. [swarm-report/mobile-gate-build.md](../../swarm-report/mobile-gate-build.md),
R8 в `risks.md`.

## 6. Один аккаунт с двух вкладок / устройств

`DuelParticipant` — partial-UNIQUE(user_id) WHERE active (П11): вторая активная
дуэль невозможна на уровне БД, роут отвечает 409 с `existing_room_id`, фронт
предлагает вернуться в текущую комнату.
Доказательство: `tests/test_duel.py` (409 и на создателе, и на присоединяющемся;
реконнект тем же гостем — НЕ 409).

Дневная и недельная попытки идемпотентны через UNIQUE(user_id, daily_id) /
UNIQUE(user_id, tournament_id): вторая вкладка получит ту же попытку и тот же
скрамбл, без ре-ролла.

## 7. Rate limits

| Роут | Лимит | Дыра, закрытая этим прогоном |
| --- | --- | --- |
| `/auth/*` | `AUTH_RATE_LIMIT` 10/min per-IP + `EMAIL_RATE_LIMIT` 3/hour per-email | — |
| `/scramble` | 60/min | — |
| `/tournament/*` | 60/min | — |
| `/daily/*` | 60/min | `GET /daily/streak` был без лимита — **добавлен** |
| `/duel/*` | 30/min | — |
| `POST /solves` | `SOLVE_RATE_LIMIT` 30/min | **добавлен**: authed-роут, но без лимита бот качал бы историю, `best_single_ms` и бейджи |
| `/admin/funnel` | — | не нужен: суперюзер-only |

Доказательство: `tests/test_auth.py` (429 по IP и по email), `tests/test_scramble.py`,
`tests/test_solves.py` (добавлен).

## Что осознанно НЕ закрыто

- Серверная валидация кадров и всё, что от неё зависит: Этап 3 заблокирован R1.
- Живые прогоны, требующие железа: камера, два браузера в дуэли, телефон.
  Это ручной чеклист QA, а не автотест.
