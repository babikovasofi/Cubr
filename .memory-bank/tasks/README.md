# Tasks — Cubr

> Текущий фокус и статус этапов. Полный чеклист с задачами и DoD —
> [workplan.md](workplan.md). Новые идеи → [roadmap](../product-overview/roadmap.md), не сюда.

## Карта зависимостей этапов
```
Этап 0 (зрение) ─► Этап 1 (соло) ─► Этап 2 (аккаунты) ─► Этап 3 (честность) ─► Этап 4 (дуэли) ─► Этап 6 (прод)
                                          └────────────────────────────────► Этап 5 (турнир) ─┘
```
Турнир (Этап 5) зависит только от 2–3 — если дуэли забуксуют, можно запуститься с турниром раньше.

## In progress
- **Этап 0 — Прототип зрения (риск-киллер) 🔴** — `/prototype` (Vite+TS).
  - ✅ Код: camera/hands(HandLandmarker)/fsm/colors(CIEDE2000+квоты)/cube/cubeState(URFDLB+solvability)/accuracy.
  - ✅ Юнит-тесты 36/36 (Vitest), tsc чисто, vite build ок. Код-ревью пройдено (2 раунда, все findings закрыты).
  - ✅ plan → build → review → rework: [swarm-report/stage0-*](../../swarm-report/).
  - ⏳ Осталось: ручной прогон браузерного цикла + тюнинг порогов на живых людях.
  - ⏳ **Гейт 0.3:** 3 света × ≥2 кубика × 1–2 человека; точность ≥90% per-sticker vs cubejs.
    <90% → стоп, пересмотр подхода к зрению. DoD стадии закрыт только после гейта.
    Инструмент: dev-роут **`/accuracy`** (сырое чтение, фикс-порядок, min-over-conditions
    Wilson-LB). Протокол: [docs/qa/stage-0.3-vision-accuracy.md](../../docs/qa/stage-0.3-vision-accuracy.md).

- **Этап 1.1 — каркас фронта** ✅ — `frontend/` (Vite+React 19+TS+Tailwind v3, роутинг,
  токены §9, Zustand). Чистые модули зрения/scramble перенесены с тестами; DOM/эффект —
  хук-заготовки. Review = **ship**. tsc 0, tests 61/61, build 0, браузерный smoke.
  Ветка `stage-1-frontend`. [swarm-report/stage1-frontend-*](../../swarm-report/).

- **Этап 1.2 — соло-экран сборки** ✅ код (⏳ manual QA) — `/solo` в `frontend/`.
  - ✅ Хук-заготовки доведены до рабочих StrictMode-safe: `useCamera`/`useHands`/`useTwisty`/
    `useScramble`/`useCubeReader`. Новый модуль `solo/`: чистый reducer `soloPhase.ts` (гейт
    таймера на `scrambleVerified`, elapsed из `o.t` кадров) + оркестратор `useSoloSession` +
    `ScrambleWalkthrough`/`CameraStage`/`ResultScreen`. `SoloPage` phase-driven.
  - ✅ tsc 0, tests 73/73 (+12 новых), review = **ship** (2 LOW). Lint FAIL = pre-existing
    infra (eslint без TS-парсера). [swarm-report/stage1.2-solo-screen-*](../../swarm-report/).
  - ⏳ **Manual QA живьём** (не автоматизируется headless): камера+кубик, полный §5.1,
    StrictMode ×2 → один стрим/player/landmarker, twisty `animateMove` в реальном браузере.

- **Этап 2.1 — каркас бэкенда** ✅ код (⏳ живая миграция) — `backend/`.
  - ✅ FastAPI + async SQLAlchemy 2.0 + asyncpg → Postgres (docker-compose), alembic **async** env,
    модели `user` (наследует `SQLAlchemyBaseUserTableUUID`) + `solves`, CORS explicit+credentials,
    pydantic-settings v2, `GET /health` (реальный `SELECT 1`). Пакетник **uv** + Python 3.12.
  - ✅ pytest 1/1, ruff/ruff-format/mypy зелёные, review = **ship** (1 LOW косметика).
    [swarm-report/stage2.1-backend-scaffold-*](../../swarm-report/).
  - ⏳ Живая миграция (`docker-compose up -d && alembic upgrade head`) — нужен Docker (нет в окружении).

- **Этап 2.2 — авторизация** ✅ код (⏳ живьём) — `backend/` на fastapi-users 15.
  - ✅ Регистрация email+пароль (argon2/pwdlib), логин JWT в httpOnly cookie (`SameSite=Lax`,
    same-origin proxy), email-подтверждение (Resend/Brevo, мокаемо), сброс пароля, Google OAuth
    (`oauth_accounts` + custom `oauth_callback` с `email_verified`-проверкой), slowapi rate-limit
    (IP через trusted-proxy XFF + отдельный per-email лимит). `SECRET` fail-closed **везде**
    (reject placeholder + min32); split `RESET_VERIFY_SECRET`. Verify НЕ гейтит логин в 2.2.
  - ✅ ruff/mypy/pytest 20/20 зелёные (вкл. config-fail-closed + rate-limit 429). Review = **ship**
    (0 HIGH; MED APP_ENV-footgun захаржен). [swarm-report/stage2.2-auth-*](../../swarm-report/).
  - ⏳ Живьём: миграция 0002 против Postgres, реальные Resend/Google-ключи, OAuth round-trip.

- **Этап 2.3 — фронт: аккаунты** ✅ код (⏳ живьём) — `frontend/` + backend `/solves`.
  - ✅ Backend: `POST/GET /solves` (auth, свои сборки, `best_single_ms`-апдейт), Solve-модель на
    портируемом `GUID` (sqlite-тестируемо), OAuth-callback → `/auth/callback?ok/error`.
  - ✅ Frontend: Vite dev-proxy `/api`→:8000 (+`vercel.json` шаблон), `src/api/{client,auth,solves}`,
    zustand `authStore` (session через `/users/me`-probe, httpOnly cookie), `ProtectedRoute`/`GuestOnly`,
    экраны login/register/verify/forgot/reset/oauth-callback/onboarding/profile, solo→`createSolve`.
  - ✅ backend pytest 27/27, frontend typecheck 0 / tests 100 / lint / build. Review = **ship**
    (2 LOW захаржены: bootstrap-retry на транзиентном сбое, open-redirect guard на `?next`).
    Браузер-смоук анон OK. [swarm-report/stage2.3-frontend-accounts-*](../../swarm-report/).
  - ⏳ Живьём (нужен Postgres+Docker/ключи/камера): цикл register→verify→login→onboarding→solo-save→profile,
    Google OAuth round-trip, камера-чек. Deviation: DNF шлётся `time_ms=1` (бэк требует >0).

- **Этап 2.4 — профили кубиков (accounts-only)** ✅ код (⏳ живьём) — `backend/` + `frontend/`.
  - ✅ Backend: таблица `cubes` (JSON `color_profile`, ключи U/R/F/D/L/B) + CRUD (лимит 5→409, один
    `is_primary` в транзакции, delete-primary promotes свежего, ownership-404), `solve.cube_id` FK `SET NULL`,
    миграция 0003. Frontend: `cubesStore`, `CubeRegisterWizard` (6 граней, reuse `captureCalibration`),
    «Мои кубики» в профиле, онбординг-мастер (skippable), селектор в соло, `cube_id` в save.
  - ✅ backend pytest 47/47, frontend typecheck 0 / tests 120 / lint / build. Review = **ship**
    (MED concurrency-race принят для MVP; LOW `getSelectedCubeId` stale-id захаржен). Живой смоук:
    limit-409, primary-инвариант, ownership-404, delete+promote, solve+cube_id — всё ок.
    [swarm-report/stage2.4-cube-profiles-*](../../swarm-report/).
  - ⏳ Manual QA: 6-гранный захват камерой в мастере; живая миграция 0003 против Postgres.

- **Vision-интеграция профилей** ✅ код (⏳ manual QA живой камерой) — `frontend/`.
  - ✅ FSM переупорядочен: `CALIBRATE_SOLVED → SCRAMBLE_SHOWN → SCRAMBLE_VERIFY → READY →
    SOLVING → STOPPED → SOLVE_VERIFY → result`. Собранный кубик показывается ПЕРВЫМ,
    `calibrate_ok` — единственный выход из calibrate (таймер не взводится раньше).
  - ✅ Quick-adjust: профиль выбранного кубика сидит refs, подстройка ОДНОЙ белой гранью
    (von-Kries per-channel gain, linear-sRGB, НЕ аддитивный Lab-сдвиг) → `~3с` вместо
    20с. Гейт «сошлось» — на наблюдаемой грани (кластер+margin), не на сдвинутых эталонах.
    Не белая грань / не сошлось → полная 6-гранная перекалибровка (fallback).
  - ✅ **Контракт `validated`:** seeded+quick-adjusted профиль = `validated:false` (одна грань
    физически не валидирует red/orange — R1). Полная 6-гранная калибровка = `validated:true`.
    Флаг session/solve-level, НЕ в схеме БД. Ranked (Этап 4) потребует `validated:true` /
    accuracy-гейт — этот флаг и есть точка врезки.
  - ✅ Accuracy-режим (`/accuracy`, гейт 0.3) получил явный honesty-барьер: НИКОГДА не сидит
    из профиля, всегда мерит свежую полную калибровку — иначе гейт 0.3 измерял бы не то.
  - ✅ tests 169 (+26), typecheck/lint/build чисто. Review = **ship** (0 findings).
    [swarm-report/vision-profile-integration-*](../../swarm-report/).
  - ⏳ Manual QA живой камерой: quick-adjust реальным кубиком, wrong-face/diverged UX,
    exposure/WB-lock по браузерам.

- **Серверная генерация скрамблов** ✅ код (первый кирпич Этапа 3) — `backend/` + `frontend/`.
  - ✅ `GET /scramble` — публичный (без auth, соло/accuracy работают анонимно), рейт-лимит
    60/minute per-IP (`services/ratelimit.py`, тот же паттерн что `AUTH_RATE_LIMIT`). Отдаёт
    `{scramble, event:"333"}`, random-MOVE 25 ходов (порт TS `randomScramble()` из
    `cubeState.ts` 1:1, без граневого повтора/редундантной opp-пары; `secrets.choice`).
    **НЕ** WCA random-STATE (нужен солвер) — сознательный MVP-компромисс.
  - ✅ Скоуп сознательно узкий: **только смена источника строки**, БЕЗ персистентности/
    `scramble_id`/честностной привязки solve↔scramble (нужна отдельная миграция +
    снятие `extra="forbid"` с `SolveCreate` — отдельный тикет Этапа 3).
  - ✅ Фронт: `useScramble` теперь бьёт `/api/scramble` вместо CDN `randomScrambleForEvent`;
    twisty-рендер (`useTwisty`) по-прежнему грузит cubing с CDN — это не убрало
    CDN-зависимость, только добавило бэкенд-зависимость для строки. Офлайн/dev-без-бэка
    фолбэк: при неудаче фетча — локальный `randomScramble()`/`randomStateFacelets()`
    (двухуровневый, без сети), ритуал не залипает на "Готовлю скрамбл…".
  - ✅ tests: backend pytest 51 (+4), frontend vitest 172 (+3), typecheck/lint чисты обе
    стороны. Review = **ship** (0 findings), qa-smoke = **pass** (живой curl-прогон,
    легальность 50×25 ходов, рейт-лимит подтверждён живьём). Полностью автономный цикл
    plan→build→review без участия пользователя.
    [swarm-report/server-scramble-generation-*](../../swarm-report/).
- **Персистентность скрамбла + `solve.scramble_id`** ✅ код (⏳ живая миграция) — `backend/` + `frontend/`.
  - ✅ Стратегия **signed HMAC token** (не store-on-GET — ноль роста таблицы/DoS на публичном
    роуте). GET /scramble отдаёт `{scramble, event, scramble_token}` (`services/scramble_token.py`:
    HMAC-SHA256, canonical JSON payload `sort_keys`, nonce+exp, base64url), **без записи в БД**.
  - ✅ POST /solves принимает **явное** опциональное `scramble_token` (SolveCreate **сохраняет**
    `extra="forbid"` — снятие было бы регрессом). Валидный → лениво пишет строку в `scrambles`
    (только реальный solve), `solve.scramble` берётся из **верифицированного** токена (сервер
    авторитетен, клиентский `scramble` игнорится), `solve.scramble_id` линкуется. Bad/expired sig
    → 422, reused nonce → 409 (SELECT + IntegrityError race-guard, one-time-use на UNIQUE), omit → 201 null.
  - ✅ Таблица `scrambles` (GUID pk, event, scramble, `nonce` UNIQUE, created_at), `solve.scramble_id`
    FK SET NULL nullable indexed, миграция **0004**. `SCRAMBLE_SIGN_SECRET` fail-closed (min32 +
    placeholder-reject, отдельный от auth `SECRET`), `SCRAMBLE_TOKEN_TTL=3600`.
  - ✅ backend pytest 65, frontend vitest 194, ruff/mypy(scope)/tsc/lint чисто. Review = **ship**
    (0 findings, крипта проверена в полном объёме). Полностью автономный цикл plan→build→review.
    [swarm-report/scramble-persistence-*](../../swarm-report/).
  - ⏳ Живая миграция 0004 против Postgres (нет Docker); end-to-end /scramble→solo→save с живым линком.
- **Честностные оси — design-note** ✅ (не код) — `solutions.md` §П5.
  - ✅ Разведены 4 оси: `status`(valid/dnf/rejected, PB-ключ) ⊥ `verify_frames_ok`(сырой bool) ⊥
    **`honesty`**(pending/verified/rejected, только сервер, появится с frame-кирпичом) ⊥
    `validated`(качество калибровки, не в БД). Прецедент Ranked = `validated==true И honesty=="verified"`.
    Заморожен инвариант: PB остаётся honesty-агностичным. Решение: `honesty`-колонку НЕ шипить
    отдельной мёртвой схемой — land вместе с первым сеттером. [swarm-report/solve-status-plan.md].
  - 🚧 **proof-frames — BLOCKED** (skeptic block, 2026-07-17). Presence-only honesty = мёртвая колонка
    (verified недостижим без OpenCV) + хранение PII-кадров без читателя = привязка П10 + storage/DoS,
    ноль сдерживания. Вывод: кадры + OpenCV = ОДИН кирпич, не два. [swarm-report/proof-frames-plan.md].
  - 🧭 **Решение (2026-07-17): scramble-binding = честностный пол Этапа 3 MVP; pivot на Этап 5.** Остаток
    честности не чистая автономная очередь: (a) frames+OpenCV = большой R&D, завязан на R1 (цвета кубика),
    нужен свой accuracy-гейт (даже браузерный 0.3 не пройден); (b) event-stream + server-таймстампы =
    Этап 4 (WS/дуэли), не соло-POST. Возвращаться к честности после ресурса на R1/камеру.

- **Этап 5 — турнир недели: attempt-lifecycle** ✅ код (⏳ живая миграция) — `backend/` (backend-only).
  - ✅ Поглотил foundation (skeptic зарезал отдельный weekly-tournament как premature — таблица без
    attempt-кирпича ничего не зарабатывает + публичный GET со скрамблом = регрессия П8).
  - ✅ `tournaments` (GUID pk, iso_year/iso_week, event, scramble; UNIQUE iso_year,iso_week) +
    `tournament_attempts` (user_id/tournament_id FK CASCADE, status started/valid/dnf, `honesty` default
    pending, time_ms, started_at/submitted_at; UNIQUE user_id,tournament_id), миграция **0005**.
  - ✅ Authed `POST /tournament/current/attempt/{start,submit}` (401 аноним). start = get-or-create
    турнир+attempt, скрамбл раскрывается **только** в authed-ответе (П8, публичного GET со скрамблом нет),
    идемпотентен (повтор → тот же attempt+скрамбл, без re-roll). submit: 404 нет attempt, 409 terminal,
    forced dnf если past `TOURNAMENT_ATTEMPT_WINDOW_SECONDS`(600). Гонки на обоих UNIQUE — `begin_nested()`
    SAVEPOINT + IntegrityError-reselect (не откат всей сессии). ISO-неделя = UTC isocalendar, week_label
    zero-pad, naive/aware datetime нормализован (sqlite vs PG).
  - ✅ **Скоуп = plumbing, НЕ анти-чит** (skeptic HIGH): time_ms self-reported, `honesty=pending` с 1-го
    дня, будущий лидерборд НЕ читает pending как доверенный. `solves`/best_single_ms/GET /solves нетронуты
    (замороженный П5 PB-инвариант). abandon→DNF = только дедлайн (realtime = WS/Этап 4); зависшие started
    подметёт finalize-cron (вне скоупа).
  - ✅ backend pytest 86 (+21), ruff/mypy(scope) чисто. Review = **ship** (0 findings, savepoint/П8/
    state-machine верифицированы). Автономный цикл plan→build→review. [swarm-report/tournament-attempt-*],
    предыстория [weekly-tournament-plan.md].
  - ⏳ Живая миграция 0005 против Postgres. Дальше Этапа 5: finalize-cron (started→dnf, ролловер недели),
    лидерборд/результаты (гейт на honesty-кирпич!).

- **Этап 5 — фронт турнира «Челлендж недели»** ✅ код (⏳ live click-through) — `frontend/` + backend GET.
  - ✅ Backend: `GET /tournament/current` authed (401 аноним), БЕЗ скрамбла, read-only (ничего не создаёт),
    отдаёт week_label + attempt_status(started/valid/dnf/null) + time_ms + deadline_at. Решает skeptic
    HIGH#1 (без него start-on-mount = утечка скрамбла + запуск дедлайна пассивному визитёру = регрессия П8).
  - ✅ Frontend: страница `/tournament` под ProtectedRoute. Mount → getCurrent → precommit|resume|terminal.
    Скрамбл раскрывается **только** из POST start и **только** после явного two-step confirm — `ActiveRitual`
    (и значит useScramble/useSoloSession) монтируется лишь после commit → П8 enforced структурно, не UI-гейтом.
    Соло-ритуал переиспользован параметризацией (`useScramble({fixed})`, `useSoloSession({fixedScramble,
    onResult,disableSoloSave})`) + извлечён `SolveRitual.tsx` (camera hidden-vs-unmount сохранён) — БЕЗ форка,
    соло регресс-фри. State-machine: 409 recover, 401 keep+retry-в-окне, forced-late-DNF объяснён, countdown.
    Фрейминг «Челлендж недели» (без фейковых standings — их нет), honesty скрыт, тихая DNF-карта (design §1).
  - ✅ backend pytest 89, frontend vitest 220 (+26, 194 без регрессий), tsc/lint/mypy чисто. Review = **ship**
    (0 findings). Автономный plan→build→review. [swarm-report/tournament-ui-*].
  - ⏳ Live click-through (нужен запущенный backend+Postgres+камера): start→ритуал→submit, resume, terminal.
  - ✅ **Живьём:** локальный Postgres 16 (brew, не Docker), миграции 0004+0005+0006 применены (upgrade/
    downgrade проверены), бэк :8000 + фронт :5173 подняты; smoke `/scramble` 200+token, `/tournament/*` 401 аноним.

- **Этап 5 — participation board (de-ranked)** ✅ код — `backend/` + `frontend/`.
  - ✅ **Решение:** рейтинговый лидерборд = преждевременный театр (всё `honesty=pending`, self-reported,
    #1=кто соврал; противоречит записанному honesty-гейту). Шипнут **de-ranked participation board**:
    список прошедших неделю по `submitted_at` (БЕЗ мест/№), «N куберов прошли», своё время лично.
    Настоящий рейтинг — после honesty-кирпича.
  - ✅ **Privacy (П10) opt-in:** новое поле `User.public_handle` (String(64) nullable, миграция **0006**),
    ставится через `PATCH /users/me` из профиля с пометкой «имя публично». Борд показывает `public_handle`
    или «Аноним» — **никогда email/nickname** (nickname по умолчанию = email-фрагмент, поэтому не берём).
  - ✅ `GET /tournament/current/standings` authed (401 аноним), read-only, БЕЗ скрамбла/rank/email/nickname.
    Frontend: `TournamentStandings` во всех фазах страницы + поле хендла в профиле.
  - ✅ backend pytest (+13, mypy/ruff чисто), frontend vitest 245 (+19, tsc/lint чисто). Review = **ship**
    (0 code/privacy багов). plan→build(exec sonnet + tests haiku)→review. [swarm-report/tournament-leaderboard-*].
- **Этап 5 — finalize (production, external-cron)** ✅ код + live — `backend/`.
  - ✅ **Дизайн по-взрослому:** НЕ in-process APScheduler (хрупкий, умирает с воркером, multi-worker
    double-run). Вместо: чистая идемпотентная `sweep_expired_attempts(session, now, window)` (started→dnf
    где `is_past_deadline`, bulk UPDATE с guard `status=="started"` → безопасно при concurrent/mid-submit)
    + standalone CLI `python -m app.jobs.finalize` (`run()`: session→sweep→commit), которую дёргает
    **внешний cron** (Monday-night §П8 / каждые N мин). Ноль зависимостей, ноль миграций, ноль lifespan.
  - ✅ **lazy-read:** `get_current_attempt` показывает expired `started` как `dnf` на чтении (через
    **transient** конструкт, не мутирует ORM-строку — landmine `copy.copy` shared-state починен) → корректность
    не зависит от частоты cron. Финализация past-недели derived (`(iso_year,iso_week)<current`), без флага.
  - ✅ Live: `python -m app.jobs.finalize` против Postgres — swept 0 → синтетический expired → swept 1 (dnf)
    → rerun 0 (идемпотентно). backend pytest **112** (+10 haiku), ruff/mypy чисто. Review = **ship**
    (1 MED landmine пойман+починен). [swarm-report/finalize-cron-*].
  - ⏳ Прод: повесить внешний cron на команду под хостинг; advisory-lock только когда появится
    неидемпотентный finalize (cups/points).

- **Этап 4 — дуэль по ссылке** ✅ код + тесты (⏳ two-browser live) — `backend/` + `frontend/`.
  - ✅ Реалтайм-WS-дуэль двух authed-игроков в комнате-по-ссылке: create → `/duel/join/<token>` →
    синхронный серверный старт с ОДНИМ общим скрамблом → Фаст (1 solve/игрок) → результат + реванш.
    In-memory `ConnectionManager` (single-worker, `main.py` refuse `WEB_CONCURRENCY>1`), heartbeat/
    reconnect-снапшот/phase-timeouts. `DuelRoom`+`DuelParticipant` (partial-UNIQUE(user_id) WHERE
    active = П11), миграция **0007**. CSWSH-handshake: Origin-allowlist + cookie-JWT + HMAC-токен
    bound `(room_id,user_id)`. `honesty=pending` (не гейтит), `compute_winner` honesty-агностичен,
    дуэли пишут **ноль** `solves` (§П5). `docs/ws-protocol.md`.
  - ✅ Review = **rework→fixed**: 4404-гейт блокировал ждущего создателя (open-комната) → reconnect-
    цикл; чинено (одинокий player_a держит сокет, менеджер узнаёт player_b при подключении) + heartbeat
    20с→10с (сервер рвёт на 15с). backend pytest 166, frontend 337, ruff/mypy/tsc/eslint чисто.
    [swarm-report/stage4-duel-by-link-*]. Коммит `dfd5ce7`.
  - ✅ **h2h-история встреч** (V2, read-only): `GET /duel/rooms/{room_id}/h2h` → счёт caller-vs-opponent
    (played/your_wins/opponent_wins/draws) по `finished` парным комнатам, симметричный предикат, счёт по
    winner_id (ничья=NULL). Room-scoped (opponent выводится сервером — нет enumeration-surface). Панель
    «Вы играли N раз, счёт X:Y (+Z ничьих)» на экране результата (fetch на result-фазе, AbortController).
    Без миграции/записи. Review = **ship** (0), qa-smoke pass. backend 218 (+12), frontend 382 (+24).
    [swarm-report/h2h-duel-history-*]. Коммит `42cfd40`.
  - ⏳ Two-browser live: инвайт→старт→сборка камерой→результат→реванш + h2h-панель.

- **V2 — ачивки и бейджи** ✅ код + тесты + live-миграция — `backend/` + `frontend/`.
  - ✅ Event-driven award-движок в СЕССИИ вызывающего (POST /solves / tournament submit / duel
    `_on_finalize`) перед единственным commit; идемпотентно (`UNIQUE(user_id,code)` + `begin_nested` +
    IntegrityError→held); **best-effort** (try/except на каждом хуке — баг движка не роняет основную
    запись). `UserBadge` + миграция **0008**, `services/badges.py` (registry+grant+evaluators+
    list_badges_for), `GET /badges` (authed), additive `new_badges[]` на SolveRead/TournamentAttemptRead.
    Бейджи: `sub_30`/`first_duel_win`/`ten_duels`/`giant_slayer`(via best_single_ms)/`weekly_debut`.
  - ✅ **Инвариант:** пишет только `user_badges` — не `solves`, не `best_single_ms`; honesty не читает
    (self-reported, не гейтит — как турнир/дуэли). Frontend: `BadgeGrid` в профиле + тосты (real
    call-sites: useSoloSession/solveSave, useTournamentAttempt, DuelPage refetch-diff).
  - ✅ Review = **ship** (1 LOW принят: `new_badges.earned_at=null`, поле UI не читает). qa-smoke =
    **pass live** (Postgres, `alembic upgrade head` 0007→0008, curl solve/badges/tournament). backend
    pytest 206 (40 badge), frontend 362, ruff/mypy/tsc/eslint чисто. [swarm-report/achievements-badges-*].
    Коммит `573b34d`. Первая V2-фича (роадмап-дисциплина: остальной V2 — после деплоя MVP).

- **V2 — график прогресса времён** ✅ код + тесты (frontend-only, read-only) — `frontend/`.
  - ✅ `components/SolveProgressChart.tsx`: inline-SVG линия `time_ms` валидных сборок по `created_at`
    из УЖЕ загруженных History-данных (`listSolves(50,0)`, без второго запроса/эндпоинта/миграции/
    зависимости). Только `status==="valid"` на линии (dnf/rejected — baseline-тики, рвут polyline на
    сегменты). PB=min(valid) в окне (var(--warning) кольцо). Y-домен устойчив к выбросам
    (`min(max, p95*1.1)`, выброс пиннится к медленной кромке — Y инвертирован, faster=выше). Empty/
    zero-valid → placeholder. Окно ≤50 («за последние сборки»). **В SolveRead нет `event`** → фильтр
    по событию невозможен без бэкенда (выброшен). ПЕРВЫЙ inline-SVG-график в проекте — паттерн на
    CSS-var токенах (тёмная тема), без charting-либы.
  - ✅ Review = **ship** (0), qa-smoke pass. frontend vitest 398 (+16), tsc/eslint чисто, package.json
    без изменений. [swarm-report/progress-graph-*]. Коммит `052fe86`.

- **V2 — карточка результата для соцсетей** ✅ код + тесты (frontend-only, read-only) — `frontend/`.
  - ✅ `share/` (resultCard.ts + shareCard.ts + ShareCardButton.tsx): client-render 1080×1080 PNG
    (время/скрамбл/дата/Cubr; дуэль — outcome + оба времени) на 2D-canvas вручную (без charting/DOM-
    snapshot-либы, ноль зависимостей). «Скачать PNG» = primary always; «Поделиться» за
    `navigator.canShare({files})` в клик-жесте (десктоп→download), AbortError глотается, objectURL
    revoke. **Паттерн canvas-рендера:** палитра из CSS-var через `getComputedStyle` (тема + hardcoded
    fallback, `var()` невалиден как fillStyle), шрифты через `document.fonts.load(...)` перед draw.
    Приватность: дуэль-карточка = только слоты/времена/outcome, НИКОГДА `winner_id`/UUID/email; no
    external image (no taint). Врезка: solo `ResultScreen` (scramble из SoloPage) + `DuelResult`
    (scramble из DuelPage), gated на наличие scramble. Турнирный результат — вне скоупа.
  - ✅ Review = **ship** (0), qa-smoke pass. frontend vitest 418 (+20), tsc/eslint чисто, package.json
    без изменений. [swarm-report/result-share-card-*]. Коммит `4e7f8a5`.

- **V2 — звуки отсчёта дуэли** ✅ код + тесты (frontend-only, read-only, duel-only) — `frontend/`.
  - ✅ `duel/countdownSound.ts`: StackMat-бипы через Web Audio (без ассетов/зависимостей) на серверном
    countdown дуэли — тик 1000Hz/0.06s на каждой оставшейся секунде + go-тон 1760Hz/0.15s в момент
    старта, sample-accurate через `osc.start(when)` off `ctx.currentTime` (маппинг `serverStartAt` один
    раз; NOOP при mute/ctx null/`state!=="running"`/past). **Паттерн Web Audio:** ОДИН shared module-
    AudioContext (не close), `installAudioUnlock()` (идемпотентные one-time `{pointerdown,keydown,
    touchstart}{once}` листенеры → `resume()`, вызов из DuelPage mount — разблок на жесте ритуала до
    countdown). Solo ВНЕ скоупа (нет фиксированного отсчёта — таймер от hands-release). Мьют-тумблер
    (localStorage `cubr_countdown_muted`, guarded, default unmuted) в CountdownOverlay; визуальный
    100ms-отсчёт нетронут; cleanup stop+disconnect при phase-change (opponent_left) — без утечек.
  - ✅ Review = **ship** (0), qa-smoke pass. frontend vitest 429 (+11), tsc/eslint чисто, package.json
    без изменений. [swarm-report/countdown-sounds-*]. Коммит `aae27f9`.

- **V2 — скрамбл дня** ✅ код + тесты + live-миграция — `backend/` + `frontend/`.
  - ✅ **Параллельная daily-вертикаль** (Decision B): турнир нетронут; чистые хелперы (`now_utc`/
    `is_past_deadline`/`display_name_for`) ИМПОРТИРОВАНЫ из `services.tournament`, соло-ритуал переиспользован
    без форка. `DailyChallenge` (UNIQUE date) + `DailyAttempt` (UNIQUE user_id,daily_id), миграция **0009**.
    Authed `POST /daily/current/attempt/{start,submit}` (скрамбл только тут — П8, идемпотентно, ~10мин
    дедлайн → forced dnf), `GET /daily/current` (без скрамбла, read-only, lazy-dnf через СВЕЖИЙ transient —
    не copy.copy), `GET /daily/current/board` (de-ranked, public_handle/«Аноним», без rank/PII). get-or-create
    через begin_nested SAVEPOINT; read scoped на сегодняшний daily_id. `finalize.py` аддитивно свипает daily
    рядом с турниром в одном commit. honesty=pending, ноль solves (§П5).
  - ✅ Exec-агенты написали код (упали на session-limit до тестов); полный backend-suite + верификация
    добиты инлайн. Миграция 0009 применена вживую (Postgres 0008→0009). backend pytest **240** (+22 daily:
    13 REST/сервис + 9 finalize вкл. cross-day rollover + свип обеих вертикалей), frontend **483** (+33 daily),
    ruff/mypy/tsc/eslint чисто. [swarm-report/daily-scramble-*]. Коммит `187fdcf`.
  - ⏳ Two-account live click-through `/daily` (камера + 2 юзера); внешний cron дёргает `python -m app.jobs.finalize`.

- **Этап 6 — лендинг + правила/приватность** ✅ код + тесты (frontend-only, статика) — `frontend/`.
  - ✅ `/` теперь ДВА лица одного роута: аноним → лендинг (герой «Судит камера», 2 CTA, 4 шага
    ритуала, 4 режима карточками, блок честности/приватности, финальный CTA); authed → прежний
    дашборд режимов. С публичной главной убраны dev-заглушки (демо-`Timer 0.00`, disabled-кнопка
    «Недоступно»); `/accuracy` остался под `import.meta.env.DEV`.
  - ✅ Публичные (БЕЗ ProtectedRoute — читаются до регистрации) `/rules` и `/privacy` на общем
    каркасе `components/DocPage.tsx`. Футер в `App.tsx` = единственная сквозная точка входа в них.
    Согласие при регистрации — строкой у кнопки со ссылками (без отдельной галочки).
  - ✅ **Правило текста: описываем то, что код делает СЕЙЧАС.** Прямым текстом: время self-reported,
    серверной перепроверки видео нет, поэтому мест/рейтинга нет (борды de-ranked); кадры на сервер
    НЕ уходят вовсе. Приватность обещает обновиться ДО включения кадров-доказательств — при landing
    честностного кирпича `PrivacyPage` правится в том же коммите.
  - ✅ **Визуальный проход по живым замечаниям пользователя** (итерации в браузере): герой получил
    `HeroStickers` — живую грань 3×3 на языке §1/§4 (наклейки, `shadow-sticker`, наклон ±6°, цикл
    «мешаем → сходится в один цвет»); изометрический 3D-кубик пробовали и выбросили как чужой
    графическому языку. Шапка 48→64px (отступление от §6, помечено в коде), знак 2×2 из §6 пробовали
    и убрали — остался словомарк `ink`. `MiniGrid` (§4 мини-сетка-индикатор) = иконка режима, свой
    цвет на режим; номера шагов ритуала — наклейки в цветах кубика. Бейдж кубков: заливка НЕ `warning`
    (§5.6) — жёлтая пилюля перетягивала экран; кубок нарисован контуром (`TrophyIcon`), эмодзи 🏆
    из UI убрано совсем.
  - ✅ **prefers-reduced-motion** в `HeroStickers` гасит таймеры целиком (не «анимация побыстрее»).
    Кадр цикла считается ДО `setState` — из updater'а React волен звать функцию отложенно/дважды.
  - ✅ Живой прогон поймал: при незапущенном бэкенде прокси отдаёт **502**, `fetch` НЕ падает, и
    `client.ts` показывал общее «Что-то пошло не так» — неотличимо от «пароль слишком простой».
    Добавлены тексты для 500/502/503/504.
  - ✅ frontend vitest **509** (+26: HomePage anon/authed/loading-развилка, честностные утверждения
    текстов, цикл живой грани + reduced-motion, статусы недоступности), tsc/eslint/build чисто.
    Инлайн-цикл без субагентов.
  - ⏳ Заглушка контакта `privacy@cubr.app` в `PrivacyPage.tsx` (`TODO(этап 6, деплой)`) — домена нет.

- **Этап 6 — заглушка для мобильных браузеров (R8 закрыт)** ✅ код + тесты (frontend-only) — `frontend/`.
  - ✅ `DesktopOnlyGate` рендерится **ВМЕСТО** детей (не поверх) на ритуальных роутах `/solo`,
    `/tournament`, `/daily`, `/duel/join/:token`, `/duel/:roomId` — иначе камера/WS ритуала поднялись бы
    под заглушкой. НЕ гейтим лендинг/`/rules`/`/privacy`/вход/регистрацию/`/onboarding`(в нём «пропустить»
    и настройки — иначе свежий мобильный юзер заперт)/`/profile`: с телефона читают и заводят аккаунт.
  - ✅ Детекция `lib/device.ts` = `(hover: none) and (pointer: coarse)`, **осознанно без ширины экрана**
    (узкое окно ≠ телефон; resize/поворот не должны выбивать из активной сборки). Ноут с тачскрином →
    `hover: hover` → проходит; планшет/iPadOS с десктопным UA → гейтится (media авторитетнее UA).
    Сломанный/отсутствующий `matchMedia` → UA-фолбэк, вслепую не гейтим. Хук `useIsHandheld` слушает `change`.
  - ✅ Escape hatch «Всё равно открыть здесь» → sessionStorage `cubr_handheld_override` (zustand
    `deviceStore`, общий для гейта и лендинга) — ложное срабатывание не делает продукт недоступным.
    Заглушка копирует **`location.href`**, не origin: инвайт в дуэль без токена бесполезен. Лендинг
    с телефона предупреждает ДО клика по CTA.
  - ✅ frontend vitest **525** (+16), tsc/eslint/build чисто, `package.json` не тронут. Инлайн-цикл
    plan→build→verify без субагентов. [swarm-report/mobile-gate-*]. Живого прогона с телефона не было.

- **Этап 6 — фильтр слов для ников** ✅ код + тесты — `backend/` + тонкий слой `frontend/`.
  - ✅ `services/moderation.py`: `check_display_name()` → `NameRejection(code, reason)`;
    коды `NAME_TOO_SHORT`/`NAME_INVALID_CHARS`/`NAME_RESERVED`/`NAME_NOT_ALLOWED`.
    Врезка в `UserManager.create/update` (регистрация + `PATCH /users/me`), ошибка =
    `HTTPException(400, {"code","reason"})` — **не** pydantic-валидатор: pydantic отдаёт 422
    со списком `detail[]`, который `parseErrorBody` в SPA схлопывает в общее «что-то пошло не так».
  - ✅ Матчинг по «скелету»: casefold+NFKD(ё→е)+омоглифы(латиница↔кириллица)+**алфавит-зависимый**
    leet (`1→и` в русском проходе, `1→i` в английском)+выброс не-букв+схлопывание повторов. Скелет
    строится ДВАЖДЫ (кириллица/латиница) + отдельный список русского мата латиницей (`pizdec`).
    Ловит `xyilo`, `п1здец`, `f_u_c_k`, `fuсk`(кириллическая с), `пииииздец`.
  - ✅ **Корни хранятся в скелетной форме** (`_as_skeletons` на импорте) — иначе литеральный `faggot`
    никогда не встретил бы схлопнутый вход `fagot`, а `поддержка` — `подержка`.
  - ✅ Анти-FP: пословные корни (`жид`/`хач`/`rape`/`dick`/`nigger` — иначе «жидкость», «хачапури»,
    «grape», «Dickens», «Nigeria» в бане), словарь исключений `_BENIGN_RU` (скипидар/застрахуй/барсуки),
    отказ от корня `nigg` (после схлопывания `nig` живёт внутри `night`).
  - ✅ Фильтруются ОБА поля (`public_handle` — единственное публичное, П10; `nickname` — впрок).
    OAuth-деривация ника из локалпарта почты **санитайзится в `cuber`**, а не роняет редирект 400-кой.
  - ✅ backend pytest **324** (+84: 74 матрица + 10 API), ruff/mypy чисто; frontend vitest **529** (+4),
    tsc/lint/build чисто. Миграций и зависимостей нет. [swarm-report/nickname-filter-*].
    Хвост: существующие ники в БД не перепроверяются (разовый скрипт — если понадобится).

- **Этап 6 — аналитика воронки** ✅ код + тесты (backend-only) — `backend/`.
  - ✅ `GET /admin/funnel` (**суперюзер-only**: аноним 401, обычный юзер 403) — 12 счётчиков
    из УЖЕ существующих строк: users → is_verified → cubes → solves → tournament/daily attempts →
    duel_participants, плюс `solves_total`/`duels_finished`/`signups_7d`/`signups_30d`/`active_7d`.
    Ноль новых таблиц, событий, миграций, зависимостей и сторонних трекеров — лендинг обещает
    «не следим» (П10), GA после такого обещания = ложь.
  - ✅ **Воронка состояний, не событий** (записано осознанно): отвечает «сделал/не сделал», а не
    «где отвалился». Событийный поток — вместе с честностным кирпичом, там таймстампы нужны по делу.
    `active_7d` = union user_id из 4 источников, а НЕ колонка `last_seen` (её заведение ради
    метрики — уже трекинг). DISTINCT на каждой ступени: 2 сборки одного = 1 в воронке, 2 в total.
  - ✅ Ответ — только целые числа + `generated_at`; отдельный тест проверяет отсутствие email/ников
    в теле. Фронта нет намеренно (оператору хватает curl); `backend/README.md` — как выдать
    суперюзера и как читать. backend pytest **334** (+10), ruff/mypy чисто.
    [swarm-report/funnel-analytics-*].

- **V3 — стрики ежедневных серий** ✅ код + тесты — `backend/` + `frontend/` (поверх скрамбла дня).
  - ✅ `GET /daily/streak` (authed, read-only, без скрамбла) → `current_streak`/`best_streak`/
    `completed_today`/`last_day`/`today`. **Стрик выводится, не хранится**: ни таблицы, ни колонки,
    ни миграции, ни джобы «чинящей серии»; правило переписывается без бэкфила (приём из воронки).
  - ✅ **День серии = ритуал, доведённый человеком:** `valid` ИЛИ `dnf` с непустым `submitted_at`.
    Брошенная попытка (свип добил в `dnf`, `submitted_at` пустой) НЕ считается — иначе серия
    набивается нажатием «начать». Честность не читаем (участие, не подтверждённый результат).
  - ✅ **Серия жива до конца следующего дня:** цепочка, кончившаяся вчера → `current_streak>0` +
    `completed_today=false` («сегодня ещё не пройден»), старше вчера → 0.
  - ✅ Фронт: `StreakBadge` на `/daily` над состоянием дня; ничего не рисует до ответа и молча
    исчезает при ошибке (украшение поверх ритуала). Плюрализация день/дня/дней — чистая функция
    с таблицей 1/2/5/11/21/22/111.
  - ✅ backend pytest **344** (+10), frontend vitest **543** (+14), ruff/mypy/tsc/eslint/build чисто.
    [swarm-report/daily-streak-*].

- **Этап 6 — прогон чеклиста состояний userflow §10** ✅ аудит + добивка — обе стороны.
  - ✅ Разбор по пунктам с ссылками на код и тесты: [docs/qa/userflow-state-checklist.md].
    Пустые состояния / загрузки / ошибки сети / камера / мобильный / вторая вкладка / rate limits.
  - ✅ **Найденные дыры закрыты:** `POST /solves` был без рейт-лимита (authed, но бот качал бы
    историю, `best_single_ms` и бейджи) → `SOLVE_RATE_LIMIT=30/minute`; `GET /daily/streak` →
    под общий daily-лимит. Матчмейкинга нет by design (дуэль по ссылке), серверной валидации
    кадров не существует — оба пункта §10 закрыты как неприменимые, а не «сделаны».
  - ✅ **Дописаны недостающие тесты:** тексты ошибок камеры (5 причин, все РАЗНЫЕ), пустая история
    в профиле, 429 на `POST /solves`. backend pytest **345** (+1), frontend vitest **550** (+7).

- **V3 — цели по рубежам sub-N** ✅ код + тесты (frontend-only, read-only) — `frontend/`.
  - ✅ `profile/goals.ts` + `GoalCard` в профиле: следующий рубеж выводится ИЗ ЛИЧНОГО РЕКОРДА по
    списку sub-2:00…sub-10 — цель не выбирается руками, поэтому нет ни поля в БД, ни экрана
    настройки, ни «протухшей» цели после прогресса. Считается из уже загруженной `listSolves(50)`
    (приём `SolveProgressChart`): ноль новых запросов/эндпоинтов.
  - ✅ **Две величины в одной карточке осознанно:** «куда дальше» (следующий рубеж + разрыв по
    рекорду) и «что закрепить» (последний ПРОБИТЫЙ рубеж + сколько последних подряд под ним, из 5).
    Рекорд без стабильности — везение, стабильность без рекорда — потолок.
  - ✅ Серия считается против ПРОБИТОГО рубежа (против следующего она всегда 0 — бессмысленна);
    `sub-N` = строго быстрее N (рекорд ровно на рубеже не берёт его); DNF не рвёт серию и не
    считается достижением (дисциплина — в ежедневных сериях, тут скорость).
  - ✅ frontend vitest **566** (+16), tsc/eslint/build чисто, бэкенд не затронут.
    [swarm-report/goals-milestones-build.md].

- **Ao5 — оживление мёртвой колонки `best_ao5_ms`** ✅ код + тесты — `backend/` + `frontend/`.
  - ✅ **Находка:** колонка приехала на Этапе 2, попала в схему и в UI, но сеттера не было —
    «Лучший Ao5» показывал «—» всем и всегда. Теперь `services/averages.py` считает Ao5 по
    правилам WCA и обновляет рекорд после каждой сборки (best-effort try/except, как бейджи —
    арифметика не имеет права уронить запись сборки; пересчёт после `flush()`, чтобы новая
    сборка попала в собственное окно).
  - ✅ Правила: отбрасываются лучшая И худшая; **одна DNF не портит среднее** (она и есть
    отброшенная худшая), две DNF → среднее = DNF; `rejected` — НЕ медленная попытка, а
    не-попытка, пропускается целиком; окно — пять последних по `created_at` (сессий в Cubr нет);
    рекорд только улучшается.
  - ✅ Фронт: `profile/average.ts` — те же правила для строки «Текущий Ao5 (последние 5)» из уже
    загруженной истории (ради одной строки не заводить эндпоинт; обе стороны тестируются на
    ОДНИХ примерах).
  - ⚠️ **Грабли для будущих тестов:** sqlite пишет `created_at` с точностью до секунды — пять
    сборок подряд через API ложатся в одну метку, и «последние пять» становятся
    недетерминированными. Сценарии на порядок вставляют строки напрямую с явными `created_at`.
  - ✅ backend pytest **360** (+15), frontend vitest **577** (+11), всё зелёное, миграций нет.
    [swarm-report/ao5-averages-build.md].

- **V3 — витрина профиля** ✅ код + тесты + живая миграция — `backend/` + `frontend/`.
  - ✅ `user.method` (закрытый список CFOP/Roux/ZZ/Petrus/слоями/другой) + `user.cubing_since_year`
    (1974..текущий), оба nullable, миграция **0010** — применена вживую (upgrade→downgrade→upgrade
    против локального Postgres). Форма `ShowcaseForm` в профиле.
  - ✅ **Витрина НЕ публичная:** публичных профилей в Cubr нет, борды несут только `public_handle`
    (П10) — подпись честно говорит «для себя»; отдельный тест проверяет, что ни метод, ни год не
    просачиваются в standings. Nullable без server_default: «не указано» — норма, бэкфил догадкой
    вложил бы людям в рот слова.
  - ✅ backend pytest **365** (+5), frontend vitest **592** (+13), всё зелёное.
    [swarm-report/profile-showcase-build.md].

- **Локализация RU/EN — проход 1** ✅ код + тесты (frontend-only) — `frontend/`.
  - ✅ **Ключ перевода = сама русская строка** (`t("Правила")`, не `t("footer.rules")`): на `ru`
    возвращается ключ → 592 существовавших теста прошли БЕЗ правок; на `en` непереведённое
    остаётся русским, а не показывает идентификатор → можно шипить проходами. Цена записана:
    переформулировал строку — потерял перевод. Ноль зависимостей (`i18n/t.ts` + `i18n/en.ts`).
  - ✅ Язык: `ru` — дефолт; автоподбор по `navigator.languages` только при РАБОЧЕМ хранилище
    (иначе выбор некуда записать; заодно это чинит jsdom, где `navigator.language` = en-US и
    тесты уехали бы на английский). Переключатель в футере, `<html lang>` меняется вместе.
  - ✅ Покрытие прохода 1: шапка/футер/меню, лендинг+дашборд, мобильная заглушка, все экраны
    входа/регистрации/подтверждения/сброса, кнопка Google, тексты ошибок API (`t(err.message)` —
    сообщения и есть ключи). НЕ переведены (следующие проходы): профиль, соло, дуэль, турнир,
    скрамбл дня, длинные правила/приватность — там UI остаётся русским.
  - ✅ frontend vitest **607** (+15), tsc/eslint/build чисто. [swarm-report/i18n-*].
  - ✅ **Проход 2:** профиль целиком (рекорды, настройки, витрина, цели, Ao5, история, график,
    бейджи, кубики+мастер) и ритуальные экраны (соло, инструкция скрамбла, дуэль+приглашение+
    отсчёт+реванш, челлендж недели, скрамбл дня, борды, серия, онбординг). Шаблонные строки
    переехали на подстановки; чистые функции (`experienceLabel`) получили переводчика параметром —
    английская фраза собирается, а не склеивается из русских кусков. Тест здоровья словаря ловит
    пустой перевод, «перевод», оставшийся русским, и разъехавшиеся подстановки. vitest **612**.
  - ✅ **Проход 3:** подсказки камеры/калибровки (`vision/guide.ts`, `cameraErrors`, `overlay`,
    `useCameraCheck`), словесные описания ходов (`scramble/moveCopy.ts`) и страницы правил/
    приватности. Динамические подсказки получили ПЕРЕВОДЧИКА ПАРАМЕТРОМ (по умолчанию русский) —
    фразу с числами нельзя склеить из русских кусков и потом перевести; старые тесты зовут их
    по-прежнему. Правила и приватность разведены по языковым файлам `pages/legal/*{Ru,En}.tsx`,
    а НЕ по словарю: пофразовый перевод длинной прозы даёт двуязычный абзац при первом пропуске.
    Синхронность двух файлов записана в их шапках (приватность правится вместе с включением
    отправки кадров). Тест стережёт, что английская версия не обещает больше русской.
    vitest **614**. Русским остался только `accuracyRun.ts` — dev-инструмент гейта 0.3.

- **Зрение: пять фиксов по живому багрепорту (2026-07-28)** ✅ код + тесты — `frontend/`.
  - ✅ **«36 наклеек расходится» = НЕ цвет.** Сверка шла в ОДНОЙ фиксированной ориентации, а человек
    берёт кубик как удобно. `vision/faceletRotations.ts` даёт 24 ориентации (перестановки выводятся
    из 3D-позиций + матриц поворотов; смещение по нормали обязательно, иначе 54 позиции схлопываются
    в 27), `lenientVerify` берёт лучший вариант эталона.
  - ✅ **Гейт мерит СЫРОЕ зрение, продукт — свой путь.** Квоты незаметно попали в то, что читал
    харнесс; `resolveSixFaces` теперь возвращает оба чтения, `/accuracy` печатает две строки.
    Вердикт гейта — только по сырому. Разрыв показывает вклад ограничений.
  - ✅ **Свет:** `normalizeFaceByCenter` — фон-Крис по СВОЕМУ центру каждой грани (центр не двигается);
    эталоны снимаются раз, а свет плывёт всю сессию.
  - ✅ **Блики:** `robustCellColor` — коридор яркости вокруг медианы ячейки + отсев выбитых пикселей,
    отдаёт долю выживших.
  - ✅ **Уверенность:** отрыв ближайшего эталона от второго; <8 из 9 уверенных ячеек → грань
    переспрашивается сразу.
  - ✅ **Геометрия:** `vision/faceFit.ts` — сетка 3×3 подгоняется под грань в кадре (перебор
    масштаб×сдвиг, оценка «ячейка близка к эталону» + штраф за разброс). Рамка ≠ кубик: раньше
    ячейки съезжали на щели и фон — это и был механизм «белая→красная».
  - ✅ vitest **656**, всё зелёное, зависимостей нет, пороги в `vision/config.ts`.
    [swarm-report/vision-accuracy-pass-build.md]. ⏳ Нужен живой перепрогон `/accuracy` (3 света × 2 кубика).

- **Зрение: раздача цветов оптимальная, а не жадная (2026-08-03)** ✅ код + тесты — `frontend/`.
  - ✅ **`vision/assignment.ts`** (новый, чистый): венгерский алгоритм + `minCostQuotaAssign`.
    Ноль зависимостей, O(n³) при n=48 — тот же порядок, что вытесненная сортировка 288 пар.
  - ✅ **Квоты 9×6 больше не жадные.** Жадный обход «сначала самые дешёвые пары» смотрит на одну
    пару и не видит, чего лишает других: наклейка, которой красный и оранжевый почти безразличны,
    забирает последний красный слот, а та, которой красный нужен позарез, уезжает в оранжевый —
    две ошибки вместо нуля, и обе в паре red↔orange (R1). Тест держит старый жадный проход
    ЭТАЛОНОМ ХУДШЕГО: суммарная стоимость оптимума не хуже жадной ни на одной колоде (40 прогонов).
  - ✅ **Вес ненадёжной ячейки.** `robustCellColor` давно считает `kept` (доля выживших пикселей),
    но ридер выбрасывал это число до раздачи. Теперь `cellWeight(kept)` множит стоимости выбитой
    бликом ячейки (пол `CELL_WEIGHT_MIN=0.2`, не ноль — иначе она невидима для оптимизации и
    уедет в случайный слот): за дефицитный слот выигрывает честно измеренная наклейка.
  - ✅ **Центры граней — тоже бижекция.** `assignFacesByCenter` решал шесть съёмок независимым
    argmin; порыжевший под тёплым светом красный центр ближе к оранжевому эталону (ΔE 9.0 против
    13.8), оранжевый достаётся дважды, красный ни разу — и всё чтение брак, хотя человек сделал
    всё правильно. Теперь одна раскладка целиком. Раскладка НЕ отказывает никогда, поэтому отказ
    вынесен явным замком `CENTER_MAX_DELTA_E=34`: центр дальше него от выданного цвета = грань
    показали дважды / в кадре стол → честное «переснять» вместо уверенно неверного чтения.
  - ⚠️ **Гейт 0.3 этих улучшений НЕ увидит**: он меряет СЫРОЕ чтение (argmin без нормировки и
    квот) — планка по самому зрению. Улучшения лежат в продуктовом пути; косвенно гейту достаётся
    только меньше отказов `assign` при сборке ground truth режима A.
  - ✅ frontend vitest **718** (+16), tsc/eslint/prettier чисто, зависимостей и миграций нет.
    Попутно вычищен mojibake в комментариях `accuracy.ts` (UTF-8, прочитанный как cp1251).
    Коммиты `de9b6cb`, `da4333c`, `e1b034d`, `ecfffa6`.

- **Разбиение бандла (2026-08-05)** ✅ код + тесты — `frontend/`.
  - ✅ Входной чанк **644 → 273 kB** (gzip 193 → 84): ритуальные роуты и правила/приватность
    за `React.lazy`, MediaPipe+cubejs уехали в общий чанк ~189 kB. Предупреждение Vite
    про 500 kB ушло. Детали и инварианты — tech-details/README.md §Разбиение бандла.
  - ✅ `scripts/check-bundle.mjs` (npm `postbuild`) держит бюджет 320 kB и следит, чтобы
    `HandLandmarker` не вернулся во входной чанк; оба отказа проверены живьём.
  - ✅ `RouteErrorBoundary` + 3 теста: упавшая загрузка чанка даёт текст и «Обновить страницу»,
    а не белый экран.
  - ✅ vitest **744** (+3), tsc/eslint/build чисто. Правило eslint для `scripts/*.mjs` (Node-глобалы).

- **Локализация RU/EN (пасы 1–4, завершено 2026-08-05)** ✅ код + тесты — `frontend/`.
  - ✅ Механика: `i18n/t.ts`, **ключ = сама русская строка**. Непереведённое место остаётся
    русским, а не показывает `footer.rules` живому человеку; реестр ключей не нужен; старые
    тесты, ищущие русский текст, проходят без правок. Цена — переформулировал строку, потерял
    перевод. Переключатель языка — `store/langStore`, словарь один: `i18n/en.ts`.
  - ✅ Пас 1 (`8ffad75`) шапка/футер/лендинг/вход-регистрация/ошибки API; пас 2 (`a8e5041`)
    профиль и ритуал; пас 3 (`06942d9`) подсказки камеры, нотация ходов, правила/приватность;
    пас 4 (`4e760fc`) турнир, скрамбл дня, серии.
  - ✅ **Ошибки переводятся в МЕСТЕ ПОКАЗА.** Строка, которую вернул хук (`useTournamentAttempt`,
    `useDailyBoard`, `vision/guide.ts`), — такой же ключ: рендер зовёт `t(error)`. До паса 4
    английская сессия видела русский, как только что-то падало.
  - ✅ **Склонения — `i18n/plural.ts`.** Ключом идёт ФРАЗА целиком, не слово: в русском
    согласуется и глагол («1 участник не финишировал» против «2 участника не финишировали»),
    словарь схлопывает три русские формы в две английские. Попутно закрыт баг грамматики,
    живший до локализации.
  - ✅ **Длинная проза разведена по файлам, а не по словарю** (`pages/legal/{Rules,Privacy}{Ru,En}.tsx`):
    пофразовый перевод даёт двуязычный абзац на первом же пропущенном ключе. Цена — два файла
    держим синхронно; для юридических текстов это и так требование (приватность правится
    ОДНОВРЕМЕННО с включением отправки кадров, в обеих версиях). Тест держит честностные
    утверждения: английская версия не обещает больше русской.
  - ✅ **Покрытие проверяется, а не осматривается**: сверка всех `t("…")` в `src/` со словарём
    даёт ноль пропусков. Сознательно русским остаётся `vision/accuracyRun.ts` + `/accuracy` —
    dev-инструмент гейта 0.3, в прод-бандл не попадает.
  - ✅ frontend vitest **741**, tsc/eslint/build чисто, зависимостей нет.

## Manual-QA bug sweep (2026-07-20, из живого теста пользователя)
Багрепорт по живому прогону сайта; чиним блоками plan→build→тесты (инлайн, субагенты на лимите).
- ✅ **A онбординг/камера** (`8532b3e`): honest hands-gate (дебаунс 8 кадров вместо латча), больше превью
  камеры (max-w-5xl+min-h), цвет-профиль = превью не пикер. [swarm-report/onboarding-camera-fixes-*].
- ✅ **C формат времени** (`7474cc5`): настройка seconds/clock в профиле, `lib/formatTime` + `settingsStore`,
  применён во всех местах показа времени. [swarm-report/time-format-setting-*].
- ✅ **B соло-флоу** (`fd17cbb`): зарегистрированный кубик не пересканируется (`useSavedProfile`);
  `captureCalibration` получил luma-гейт (пустой кадр не захватывается). [swarm-report/solo-flow-fixes-*].
- ⏳ **D ядро зрения (R1)** — ЗАБЛОКИРОВАН на данных: матчинг (`lenientVerify`) УЖЕ angle-invariant; «35 не
  совпадают» = испорченная классификация цвета (мусор из calibrate). Нужен прогон пользователем dev-роута
  **`/accuracy`** (3 света × ≥2 кубика, гейт 0.90 Wilson-LB) — без реальных per-sticker чисел цвет вслепую.
  Presence-детекция solved-vs-пустой-стол и точность цвета — часть R1, требует железа.

## Слито в main (2026-08-05)
**PR #13** → merge-коммит `fcfa461` (`23a7a40..fcfa461`), 78 коммитов, 359 файлов,
+41085/−1083. Ветка `feat/stage3-5-scramble-tournament` больше не рабочая — новые ветки
режем от `main`.
- Содержимое: всё описанное выше от «Персистентность скрамбла» до «Разбиение бандла» —
  Этапы 3 (пол честности), 4 (дуэли), 5 (турнир), 6 (лендинг/гейт/модерация/воронка/деплой-
  артефакты), пачки V2 и V3, проходы по зрению, локализация RU/EN, разбиение бандла.
- Миграции **0004…0010** — все применены и откачены против локального Postgres 16.
- Зелёное на момент мержа: backend pytest **367**, frontend vitest **744**,
  ruff/mypy/tsc/eslint/build чисто.
- CI в репозитории **нет** (`statusCheckRollup` пуст) — тесты гоняются локально руками.
  Если заводить GitHub Actions, это отдельный тикет.
- **Не покрыто тестами и не проверено живьём** (перенесено в открытые хвосты ниже): гейт 0.3,
  manual QA соло/дуэлей/телефона, сборка Docker-образа (локально Docker нет — первая
  настоящая сборка будет на Railway).

## Гейт 0.3 — живая сессия 2026-08-05 (ветка `fix/vision-stickerless-facefit`, НЕ слита)

Первый настоящий заход на гейт с камерой. Ветка от `main` (`fcfa461`), 6 коммитов,
frontend vitest **785**, tsc/eslint/prettier чисто. PR ещё не открывался.

**Что сделано.**
- `c8a32b7` **третий режим счёта «по картинке»** (`scorePictureGrip`). Строгая хватка мерила
  руки, свободная сравнивает МУЛЬТИМНОЖЕСТВА и слепа к перестановке наклеек внутри грани —
  а продукту нужны позиции (из них собирается состояние для cubejs). Новый режим сравнивает
  позиции с точностью до поворота грани; поворот берётся из ФИЗИКИ (`pinRotationsByPhysics`,
  `cubePhysics.ts`: у угла по одной наклейке с каждой оси, у ребра из разных, каждый кубик
  один раз), скрамбл в выборе не участвует. `resolveRotations` для этого не годится — он
  требует полной легальности, одна ошибка цвета отвергает чтение целиком, и гейт умел бы
  ставить только 100% или «брак». Неоднозначный поворот → дроп `ambiguous`, не подгонка.
- `1f02a4d` **геометрия stickerless** (план `swarm-report/stickerless-face-fit-plan.md`,
  сборка агентом в worktree). Признак «щели темнее наклеек» на монолитном кубике мёртв
  (контраст 0 и в минус), штраф насыщался одинаково у всех кандидатов и сокращался — выбор
  вырождался. Добавлен перепад цвета на ВНУТРЕННИХ границах сетки, ВТОРЫМ независимым
  слагаемым (`FACE_FIT_EDGE_WEIGHT=0.5`, `EDGE_TARGET=12`). НЕ через `max`: замерено, что
  `max` роняет стикерную фикстуру с 4.97 до 1.12 при требовании >3.00. `EDGE_WEIGHT=0` даёт
  тождество со старым поведением — это тест, а не надежда. Подгонка стала в 1.67× медленнее.
- Диагностика (`e383f19`, `12167cf`, `5ff41de`, `7089054`) — четыре БАГА в том, что человек
  читает на экране, все найдены живым прогоном:
  1. Сообщение печатало порог АБСОЛЮТНОГО замка при сработавшем относительном: «в 30.0 от
     цвета, допустимо 34» — самоопровержение, пользователь решил «не работает».
  2. Назывался ПЕРВЫЙ нарушитель вместо худшего (съёмка 5 с ΔE 30 при беде в шестой с 55).
  3. `scorePictureGrip` индексировал наклейки по ПОВЁРНУТОЙ позиции и слоту URFDLB, а
     `cellDiagnostics` лежит в порядке СЪЁМОК и без поворота — отчёт клеил «прочитано»
     одной ячейки к RGB другой. Счёт верных при этом был верен; врала ровно диагностика.
  4. Текст обвинял «ты не показала грань X», когда центр просто плохо прочитан. Дубликат от
     misread различается по тому, к чему съёмка тянется САМА вне бижекции.
  Теперь строка центров печатает свой цвет + сырой RGB, а «Подгонка сетки» — контраст границ,
  отрыв и «фаза сетки определена».

**Что намерено НЕ сделано (блокер B1, подтверждён пользователем).** Путь гейта не тронут:
ни переспроса грани, ни новых причин дропа. `decided`/`margin`/`edge` — ТОЛЬКО телеметрия.
Машинерия отказа = отдельная задача после живых чисел; протокол требует считать дропы в
знаменателе, а «точность выросла, drop-rate не изменился» — подпись survivorship bias.

**Замеры (шаг 0, синтетика, в плане таблицей).** Правильный кандидат есть в переборе всегда,
включая 15° с трапецией — блокер B2 снят, поворот/аспект в `candidateRegions` НЕ нужны.
Стикерный выбирает 9/9 при любом угле; stickerless выбирал 1–4 из 9. Стикерный при 12–15°
садится на `gap 14.0` при цели 12 — **поднимать `FACE_FIT_GAP_TARGET` нельзя**, запас 2.

**Живые числа гейта (условие = свет × кубик × хватка, нужно ≥20 чтений и drop ≤15%).**
- `день / стикерный / free`: 48/48 = 100% (n=1).
- `день / stickerless / free`: 93.8 / 66.7 / 66.7%, drop 50→67% — ДО правки геометрии.
- `led / стикерный / picture`: 60.4% (n=1, диагностика была битой), затем **48/48 = 100%**
  (n=1, чисто). На грани L контраст щелей **−9.7**, а чтение верное — первый живой намёк,
  что новый признак работает (не доказательство).
- `led / stickerless / picture`: **не получено ни одного чтения.** Пять попыток, все в дроп.

**Открытый вопрос, с которого начинать.** На stickerless под LED центр ОДНОЙ съёмки читается
мимо: `1:L 37, 2:R 2, 3:F 5, 4:D 3, 5:U 1, 6:B 15` при медиане 3.8. По подсказке пятой идёт
оранжевая грань, а раскладка отдала ей БЕЛЫЙ с ΔE 1 — то есть центр оранжевой грани прочитан
как белый, два центра претендуют на белый, и первой съёмке достаётся незанятый оранжевый с
ΔE 37. Пользователь независимо заметил «оба раза проблема с оранжевым». Отдельная попытка
прошла раскладку и встала на физике: 8 комбинаций поворота нарушают её одинаково по 6
нарушений (у правильного чтения 0) — чтение битое по существу, не только геометрия.
**Нужен ПОЛНЫЙ отчёт (кнопка «Копировать отчёт») с эталонами калибровки** — просился четыре
раза, ни разу не получен. Без него неизвестно, не слиплись ли оранжевый с белым ещё на
калибровке; тогда чинить надо калибровку, а не геометрию.

**Хвост инструмента** ✅ закрыт (`b409241`, 2026-08-18). Подпись «min попарный ΔE … если мало
~<20» расходилась с порогом вердикта `CALIB_MIN_SEPARATION_DE=10` — на 12.7 текст пугал, вердикт
пропускал, и человек не знал, какому числу верить. Теперь подпись берёт порог из конфига: число
в блоке одно. Плюс `nearestNeighbours()` (`vision/colors.ts`) — ближайший сосед у КАЖДОГО
эталона, а не одна самая тесная пара: живой отказ был про конкретную пару L–U, и если тесной
оказывалась другая, вопрос «слиплись ли оранжевый с белым» отчёт не отвечал. frontend vitest
**787** (+2 кейса, включая адресный «оранжевый эталон уехал в белый»).

## Сессия 2026-08-18 — харнесс, CI и форматтеры (ветка та же)

- **Харнесс** (`ccb55fe`): приехали `night-runner` (автономный ночной агент, ветка
  `night/<slug>-<ts>` от `main`, ноль пушей и мержей, коммит только после зелёных build+тестов,
  иначе откат в `.memory-bank/night-log.md`) и скилл `/pulse` (замер состояния из фактов git +
  Memory Bank + тестов, шесть фиксированных строк, журнал `.memory-bank/pulse.md`). `startpoint`
  вендорится рядом как источник обоих. Рельсы записаны в `AGENTS.md` и
  `steerings/development-conventions.md`.
- **Первый пульс снят** — `.memory-bank/pulse.md`, база = весь репозиторий (103 коммита от
  `de25f70`). Он и нашёл два расхождения ниже.
- **Форматтеры разъехались молча** (`9113b45`): prettier был красный на 28 файлах фронта,
  `ruff format` — на 15 файлах бэка (в проде `app/seed.py`, `services/duel.py`, `services/email.py`),
  ни одного из них никто не трогал, а Memory Bank считал обе стороны чистыми. Обе стороны уехали
  одинаково и одновременно — похоже на смену версии форматтера, не на чью-то правку. Переписаны,
  диффы — только переносы и склейка литералов.
- **CI заведён** (`.github/workflows/ci.yml`): два независимых джоба — backend
  (`ruff check` · `ruff format --check` · `mypy app` · `pytest`, python из `backend/.python-version`,
  зависимости `uv sync --frozen`) и frontend (`prettier --check` · `typecheck` · `lint` · `vitest` ·
  `build`, Node 24 — пересечение требований vite 8 и vitest 4). Секреты и сервисы не нужны:
  бэкенд-тесты сами ставят env в `tests/conftest.py` и живут на sqlite, фронт — jsdom.
  **Проверки форматтеров в CI стоят намеренно** — именно их отсутствие и дало дрейф выше.
  `npm run build` в CI безопасен: `prebuild` валит сборку только на прод-сборке Vercel.
- **Свежий прогон обеих сторон** (2026-08-18): backend pytest **367**, ruff, mypy 57 файлов;
  frontend vitest **787**, tsc, eslint, build (входной чанк 273.9 kB при бюджете 320).

## Planned (следующий фокус)
- **Этап 6 — остаток прод-подготовки:** ⏳ выкатка руками (нужны аккаунты и домен —
  сделать по [docs/deploy.md](../../docs/deploy.md)), затем закрытый тест на 3–5 куберах.
  Артефакты для выкатки готовы (2026-08-05, коммит по `docs/deploy.md`): `backend/Dockerfile`
  (двухстадийный uv, non-root, один воркер), `backend/railway.json` (`preDeployCommand`
  = `alembic upgrade head`, healthcheck `/health`, `numReplicas: 1`), `backend/.dockerignore`,
  SPA-фолбэк в `frontend/vercel.json`, раннбук `docs/deploy.md` (домен, HTTPS, SPF/DKIM,
  Google-redirect, cron, бэкапы, смоук, откат).
  - **Хостинг решён: Railway** (не Render) — под него и написаны конфиги.
  - **Реплика ровно одна, это не тюнинг:** комнаты дуэлей в памяти процесса, поэтому
    `WEB_CONCURRENCY=1` + `numReplicas: 1` + `--workers 1`; `main.py` отказывается стартовать
    при >1. Горизонтальное масштабирование = сначала вынести состояние комнат в Redis.
  - **Адрес бэкенда в `vercel.json` подставить переменной НЕЛЬЗЯ** — Vercel читает файл до
    сборки. Поэтому `frontend/scripts/check-api-proxy.mjs` (npm `prebuild`) валит прод-сборку
    Vercel с оставшимся плейсхолдером; локально — только предупреждение.
  - **`.env.example` больше не расходится с `config.py`** — `backend/tests/test_env_example.py`
    сверяет список в обе стороны (пропущенная настройка / мёртвая строка). Пропущено было 8.
  - ⚠️ Образ **не собран локально** — Docker в окружении нет. Первая настоящая сборка будет на
    Railway; если упадёт, смотреть стадию `uv sync --frozen`.
- **Этап 1.2 manual QA** — прогнать §5.1 живьём (см. выше), тюнинг порогов `config.ts`.
- **Этап 3 — серверная честность:** серверные скрамблы, поток событий с таймстампами, кадры-доказательства,
  OpenCV-перепроверка, валидация → `solve.status`. Ranked-гейт (accuracy / `validated:true` перед
  соревновательным таймером) — часть Этапа 4, врезка на готовый флаг `validated`.
- Прототипы `prototype/`+`prototype2/` **удалены** (DOM-порт добит в 1.2; код в `frontend/`).
- Пройти гейт Этапа 0.3 (живьём, ≥90%) — пререквизит, отдельно.
- Этапы 2–6 — см. [workplan.md](workplan.md).

## Done
- Скелет проекта (startpoint): Memory Bank, `.claude/` skills+agents+hooks, first commit.
- Разбор raw ТЗ/дизайна → структурировано в Memory Bank (+ спека визуального скрамбла).
- Этап 0 прототип зрения + Этап 0 гайд + прототип walkthrough (prototype2) — код готов, review-clean.
- PR #1 (bootstrap + прототипы) слит в main.

## Бэклог организационный (не забыть)
- ✅ Словомарк «CubeDuel» → **Cubr** в UI и доках (2026-08-18). В коде старого имени не было
  вовсе; переименована шапка `design-system.md`, уточнён нейминг-блок `product-overview/README.md`.
  Осталось только на **картинках** макетов (`tech-details/design-reference/`) — они переснимаются
  вместе с дизайном, подпись под ними предупреждает о расхождении. Исторические `raw/` и
  `swarm-report/` не трогаем: это записи о прошлом.
- Проверить свободен ли домен под имя Cubr до брендинга.
