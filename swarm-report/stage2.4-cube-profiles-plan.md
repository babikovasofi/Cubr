# Plan: Этап 2.4 — профили кубиков (accounts-only)   (slug: stage2.4-cube-profiles)

## TL;DR
Персистентность кубиков: таблица `cubes` (JSON color_profile — 6 Lab-эталонов) + CRUD (лимит 5,
ровно один `is_primary`), `solve.cube_id` (nullable FK, `SET NULL`). Фронт: мастер регистрации
(6 граней, переиспользует существующий `captureCalibration`), «Мои кубики» в профиле, регистрация
первого кубика в онбординге (замена placeholder 2.3), селектор кубика в соло → пишется в `solve.cube_id`.
**Скоуп-решение (утв.):** быстрая подстройка одной гранью (spec B.2) и потребление профиля в ритуале —
**ВНЕ 2.4** (отдельная vision-задача, гейт на Этап 0). Профиль сохраняется на будущее; `/solo` зрение
не трогаем — селектор кубика сейчас = метаданные к результату, не влияет на чтение.

## Acceptance criteria (observable; /review проверяет)
1. `POST /cubes` создаёт; 6-й при 5 существующих → **409** `{code:CUBE_LIMIT}` (server-side, в транзакции), не 500.
2. Первый кубик авто-`is_primary=true`; `POST/PATCH is_primary=true` снимает флаг с остальных кубиков
   ТОГО ЖЕ юзера (ровно один primary), в одной транзакции.
3. `GET /cubes` — только свои; чужой по id → **404** (не 403-утечка).
4. `DELETE /cubes/{id}`: если удалён primary и остались — новый primary = самый свежий; связанные
   `solves.cube_id` становятся NULL (FK `SET NULL`), сборки сохраняются.
5. `POST /solves` с `cube_id` чужого/несуществующего → **404/422**; со своим → `cube_id` записан, виден в `GET /solves`.
6. Онбординг: шаг «Регистрация кубика» снимает 6 граней и создаёт кубик на сервере (placeholder удалён);
   шаг **skippable** (профиль в соло пока не потребляется → кубик не обязателен для игры).
7. «Мои кубики» (секция в `/profile`): список — название, палитра-миниатюра 6 цветов, дата, метка «основной»;
   переименовать / сделать основным / удалить работают против API; «Добавить» скрыт/дизейбл при 5.
8. Соло-лобби: селектор «Кубик: [основной ▾]» (default primary); выбор → `cube_id` сохраняемого солва.
9. `alembic upgrade head`/`downgrade` на Postgres создаёт/откатывает `cubes` + `solves.cube_id`.
   backend pytest + frontend vitest/typecheck/lint зелёные.

## Plan (merged: planner + skeptic HIGH/MED/LOW)

### A. Backend (agent: python-fastapi, ПЕРВЫМ — контракт)
- **`models/cube.py`** — NEW `Cube(Base)` table `cubes`, зеркало solve.py: `id` GUID PK, `user_id` GUID
  FK `user.id` ondelete=CASCADE index, `name` String(64) NOT NULL, `note` String(255) null, `is_primary`
  Bool server_default `false`, **`color_profile` `sa.JSON().with_variant(JSONB,"postgresql")`** NOT NULL
  **[skeptic HIGH portability]** (dict `{face:[L,a,b]}`), `created_at`/`recalibrated_at` timestamptz now().
- **`models/solve.py`** — **[skeptic HIGH FK]** `cube_id: Mapped[uuid.UUID|None]` = `GUID`,
  `ForeignKey("cubes.id", ondelete="SET NULL")`, nullable, index (не CASCADE — сборки переживают удаление кубика).
- **`models/__init__.py`** — экспорт `Cube`.
- **`schemas/cube.py`** — NEW: `CubeCreate` (extra=forbid; `name` min1/max64, `note` max255 opt, `is_primary`
  bool=False, `color_profile` dict с валидатором **ровно 6 ключей**, каждый — tuple[float,float,float]);
  `CubeUpdate` (name/note/is_primary opt; НЕ color_profile); `CubeRead` (from_attributes).
  **[skeptic HIGH color-key]** ключи профиля = **позиционные грани `U/R/F/D/L/B`** (пространство ридера),
  НЕ спецовские W/Y/R/O/B/G — так read-time классификация сможет потребить его позже.
- **`schemas/solve.py`** — `SolveCreate += cube_id: UUID|None=None`; `SolveRead += cube_id`.
- **`routers/cubes.py`** — NEW `APIRouter(prefix="/cubes")`, все `Depends(current_active_user)`:
  - `POST ""` (201): **[skeptic HIGH/MED]** в одной транзакции — `count(user's cubes)>=5` → 409 `CUBE_LIMIT`;
    первый → auto `is_primary=True`; если `is_primary` — сбросить флаг у остальных (`UPDATE ... WHERE user_id`).
  - `GET ""` — свои, `created_at desc`.
  - `PATCH "/{id}"` — owned-or-404; rename/note/set-primary (сброс остальных в транзакции).
  - `DELETE "/{id}"` — owned-or-404; **[skeptic HIGH invariant]** если был primary и остались — promote
    самый свежий; `recalibrated_at` при recalibrate (опц., минимально).
  - helper `_get_owned_cube(session,user,id)` → 404.
- **`routers/solves.py`** — **[skeptic LOW]** валидировать `payload.cube_id` (принадлежит юзеру → иначе 404/422),
  прокинуть в `Solve(cube_id=...)`.
- **`main.py`** — include cubes router.
- **`migrations/versions/0003_cubes.py`** — NEW hand-written, **[skeptic MED]** `down_revision="0002_oauth_accounts"`:
  create `cubes` (JSONB на Postgres) + `ix_cubes_user_id`; `add_column solves.cube_id` + FK `SET NULL` + `ix_solves_cube_id`.
  downgrade реверсит. Offline `--sql` проверить (нет Docker).
- **`tests/conftest.py`** — **[skeptic HIGH]** добавить `Cube.__table__` в `create_all` tables-список.
- **Tests:** `tests/test_cubes.py` (CRUD, limit-5→409, primary-uniqueness, ownership-404, delete-promotes-primary,
  delete→solves.cube_id NULL); `tests/test_solves.py` += свой cube_id персистится, чужой/неизвестный → отбит.

### B. Frontend (agent: react-ts, ПОСЛЕ backend)
- **`src/api/cubes.ts`** — NEW: типы `CubeRead/Create/Update`, `listCubes/createCube/updateCube/deleteCube`.
  `ColorProfile = Record<"U"|"R"|"F"|"D"|"L"|"B",[number,number,number]>`.
- **`src/api/solves.ts`** — `+cube_id?:string|null` в Create/Read.
- **`src/store/cubesStore.ts`** — NEW zustand: список, `load()`, `selectedCubeId` (default=primary,
  persist localStorage), `setSelected`, мутаторы (create/update/delete) держат список + primary-инвариант;
  non-reactive `getSelectedCubeId()` для solo-save.
- **`src/vision/hooks/useCubeReader.ts`** — **[skeptic HIGH]** добавить `getProfile(): Refs|null`
  (вернуть `refsRef.current` = вывод `calibrate()`, ключи U/R/F/D/L/B). Логику калибровки не трогаем.
- **`src/cubes/CubeRegisterWizard.tsx`** — NEW: `CameraStage`+`useCamera`+`useCubeReader`, гонит существующий
  6-гранный `captureCalibration` (1/6..6/6) → форма name(обяз)+note + превью 6 swatch → `createCube(
  {name,note,color_profile:getProfile(),is_primary?})`. **[skeptic risk]** StrictMode-safe: зеркалить
  imperative-start + unmount-cleanup паттерн из useSoloSession. `onDone/onCancel`.
- **`src/cubes/CubeList.tsx`** — NEW «Мои кубики»: список (name, мини-палитра 6, дата, «основной»),
  переименовать/сделать-основным/удалить; «Добавить» → wizard (скрыт при 5).
- **`src/pages/ProfilePage.tsx`** — секция «Мои кубики» `<CubeList/>` (settings живут тут, §8; отдельного /settings нет).
- **`src/pages/OnboardingPage.tsx`** — заменить CubeStep-placeholder на `CubeRegisterWizard` (первый → is_primary);
  **[skeptic MED]** шаг skippable; жёсткого «нужен кубик до игры» гейта НЕТ в 2.4 (профиль в соло не потребляется).
- **`src/pages/SoloPage.tsx`** — селектор кубика (из cubesStore, default primary) в лобби/verify-хедере.
- **`src/solo/solveSave.ts`** — `buildSolvePayload(+cubeId:string|null)` → `cube_id` в payload.
- **`src/solo/useSoloSession.ts`** — на result-save читать `getSelectedCubeId()`, прокинуть.
- **Tests (vitest):** cubes api shape; `buildSolvePayload` включает `cube_id` (и `null` без выбора);
  cubesStore держит один primary + persist selectedCubeId.

### Tests (сводно)
- backend `test_cubes.py` + `test_solves.py` (см. A). frontend vitest (см. B).
- Manual: онбординг регистрирует 1-й кубик ≤30с → «основной» в «Мои кубики»; 2-й кубик, переключить селектор,
  собрать → `GET /solves` показывает выбранный `cube_id`; 6-й → заблокирован; удалить primary → promote.

## Blockers
Нет. Скоуп-решение принято: **быстрая подстройка (spec B.2) отложена** — солопоток зрения не меняется,
профиль сохраняется для будущего потребления.

## Out of scope
- **Быстрая подстройка одной гранью** (spec B.2) + критерий ΔE «сошлось/не сошлось» — vision-задача, гейт Этап 0.
- **Потребление профиля в ритуале** (чтение против сохранённого + Part A порядок фаз FSM) — солопоток не трогаем.
- «Показал не тот кубик» детекция (spec acceptance #5) — зависит от подстройки.
- Статистика по кубикам, кубик в публичном профиле/лидербордах (roadmap).
- Отдельная страница `/settings` (сейчас секция в `/profile`).
- Перекалибровка = delete+re-register (полноценный recalibrate-PATCH color_profile — опц./минимально).

## Assumptions
- `color_profile` = face-keyed Lab `{U:[L,a,b],R,F,D,L,B}` (вывод существующего `calibrate()`), НЕ спецовские
  W/Y/R/O/B/G (иллюстративны) — канон = 6 калибровочных эталонов ридера.
- Лимит превышен → 409 `CUBE_LIMIT` (RU-копия на клиенте).
- «Мои кубики» = секция в `/profile` (нет /settings-роута).
- Удаление primary → promote самый свежий (spec молчит про tie-break).
- `cube_id` FK `SET NULL` — историческая сборка переживает удаление кубика.
- Онбординг-регистрация skippable; localStorage `cubr_onboarded` — UX-хинт, не авторитет; жёсткого гейта нет (профиль не потребляется).
- Quick-adjust ничего на сервер в этом этапе не пишет; персистится только полная 6-гранная регистрация.
