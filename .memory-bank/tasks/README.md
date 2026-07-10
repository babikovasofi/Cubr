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

## Planned (следующий фокус)
- **Этап 1.2 manual QA** — прогнать §5.1 живьём (см. выше), тюнинг порогов `config.ts`.
- **Этап 2.4 — профили кубиков** ([feature-cube-profiles](../product-overview/feature-cube-profiles.md)):
  таблица `cubes` + CRUD, мастер регистрации, «Мои кубики», регистрация в онбординге (заменяет placeholder),
  селектор кубика, `solve.cube_id`. Требует прототип профилей Этапа 0 (часть A/B).
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
