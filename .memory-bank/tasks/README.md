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

## Planned (следующий фокус)
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
- Переименовать словомарк «CubeDuel» → **Cubr** в дизайне/UI (макеты пока со старым именем).
- Проверить свободен ли домен под имя Cubr до брендинга.
