# Build: Этап 2.4 — профили кубиков (accounts-only)   (slug: stage2.4-cube-profiles)

Plan: [stage2.4-cube-profiles-plan.md](stage2.4-cube-profiles-plan.md).
Cross-layer, последовательно: **python-fastapi (cubes API + миграция) → react-ts (wizard + UI)**.

## A. Backend (agent: python-fastapi) — done
Changed: `models/cube.py` (NEW), `models/solve.py` (+cube_id FK SET NULL), `models/__init__.py`,
`schemas/cube.py` (NEW, 6-face validator), `schemas/solve.py` (+cube_id), `routers/cubes.py` (NEW CRUD),
`routers/solves.py` (валидация+персист cube_id), `main.py`, `migrations/versions/0003_cubes.py` (NEW),
`tests/conftest.py` (+Cube table + sqlite `PRAGMA foreign_keys=ON`), `tests/test_cubes.py` (NEW), `tests/test_solves.py` (+cube_id).

**API:** `POST /cubes` (201; 6-й→409 `CUBE_LIMIT`; первый auto-primary; is_primary=true сбрасывает остальные),
`GET /cubes` (свои, created_at desc), `PATCH /cubes/{id}`, `DELETE /cubes/{id}` (204; delete-primary promotes свежего),
`POST /solves` (+cube_id?, чужой→404), `GET /solves` (SolveRead +cube_id).

**Skeptic-констрейнты:** color_profile keys = **U/R/F/D/L/B** (не W/Y/R/O/B/G); portable
`sa.JSON().with_variant(JSONB,"postgresql")`; `cube_id` FK **SET NULL** (сборки переживают удаление);
инварианты primary/limit в транзакции; миграция 0003 `down_revision=0002` (offline `--sql` ок, FK/индексы верны).

**Гейты (проверено дважды):** ruff clean · mypy 24 файла clean · **pytest 47 passed**.

## B. Frontend (agent: react-ts) — done
Changed: `src/api/cubes.ts` (NEW), `api/solves.ts` (+cube_id), `api/client.ts` (RU `CUBE_LIMIT`),
`store/cubesStore.ts` (NEW zustand, single-primary + persist selectedCubeId), `vision/colors.ts` (+`lab2rgb`
для swatch), `vision/hooks/useCubeReader.ts` (+`getProfile()`), `cubes/{useCubeRegister,CubeRegisterWizard,
CubeList,CubeRow,ColorPalette,CubeSelect}` (NEW), `pages/ProfilePage.tsx` («Мои кубики»), `OnboardingPage.tsx`
(placeholder→wizard, skippable), `SoloPage.tsx` (селектор), `solo/{solveSave,useSoloSession}.ts` (cube_id).
+ 4 теста.

**Находка:** ридеровский `Refs` уже `Record<"U"|..."B",[number,number,number]>` = backend `ColorProfile` →
`getProfile()` возвращает `refsRef.current` как есть, конверсия не нужна. Wizard StrictMode-safe (паттерн useCameraCheck).

**Гейты (проверено дважды):** typecheck 0 · **tests 119 passed** · lint clean · build ok (80 модулей).

## Живой смоук (полный стек: backend :8000 sqlite + фронт :5174, seed-аккаунт)
- login 204 → `POST /cubes` ×2 → GAN 356 (auto-primary) + школьный (не primary). Инвариант держится.
- `/profile` «Мои кубики»: GAN 356 **ОСНОВНОЙ** + переименовать/удалить; школьный + сделать основным/удалить. Консоль чистая.
- **limit-5:** создано 5, **6-й → 409**. **solve+свой cube_id → 201** (записан в историю); **solve+чужой cube_id → 404**.

## Осталось (manual QA — нужна реальная камера)
- 6-гранный захват в `CubeRegisterWizard` (getUserMedia/MediaPipe) — онбординг регистрирует 1-й кубик ≤30с,
  превью 6 swatch, появляется «основной». Только этот путь headless не покрыть.
- Живая миграция 0003 против Postgres (offline `--sql` ок; нет Docker).

## Out-of-scope (по плану/решению)
Быстрая подстройка (spec B.2) + потребление профиля в ритуале + Part A порядок FSM — отдельная vision-задача (гейт Этап 0).
Селектор кубика сейчас = метаданные к результату, зрение не трогает.
