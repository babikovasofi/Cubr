# Build: Серверная генерация скрамблов (slug: server-scramble-generation)

Plan: [server-scramble-generation-plan.md](server-scramble-generation-plan.md). Агенты:
`python-fastapi` (бэк, model: sonnet), `react-ts` (фронт, model: sonnet).

## Changed files

### Backend (`python-fastapi`)
- `app/config.py` — `SCRAMBLE_RATE_LIMIT: str = "60/minute"`.
- `app/services/scramble.py` (NEW) — `random_scramble()`, портирует 1:1 TS
  `randomScramble()` из `frontend/src/vision/cubeState.ts` (грани URFDLB, суффиксы
  `['', "'", "2"]`, без повтора грани подряд, без редундантной opp-пары); `secrets.choice`
  вместо `Math.random`.
- `app/schemas/scramble.py` (NEW) — `ScrambleOut { scramble: str; event: str = "333" }`.
- `app/routers/scramble.py` (NEW) — `GET /scramble`, без auth, рейт-лимит через
  `services/ratelimit.py` (IP-keyed).
- `app/main.py` — роутер зарегистрирован рядом с cubes/solves (корень, без `/api`).
- `tests/test_scramble.py` (NEW) — 4 теста.

### Frontend (`react-ts`)
- `src/api/scramble.ts` (NEW) — `fetchScramble(signal?)` через общий `api/client.ts`.
- `src/scramble/hooks/useScramble.ts` — `generateScramble()` теперь бьёт `fetchScramble()`;
  на ошибке фетча — фолбэк на локальный `randomScramble()`+`scrambleToFacelets()`, при
  двойном отказе — на `randomStateFacelets()`; только если оба падают — error-state.
  Сигнатура хука (`loading/error/regenerate`, cancelled-flag, facelet-мост) не изменена —
  `useSoloSession.ts`/`useAccuracySession.ts` правок не потребовали. Мёртвый импорт
  `loadCubing` убран (остался только в `useTwisty.ts` для рендера).
- `tests/scramble/useScramble.test.ts` (NEW, папка создана) — 3 теста: успех, офлайн-фолбэк,
  двойной отказ → error+retry.

## Гейты (агенты + orchestrator)
```
backend:  pytest      51 passed (4 новых)
backend:  ruff check  чисто
backend:  ruff format 4 pre-existing файла вне скоупа (не трогали); все 6 наших — чисты
backend:  mypy        8 pre-existing ошибок вне скоупа; на 6 наших файлах — чисто
frontend: vitest      19 файлов, 172 passed (+3 новых)
frontend: tsc         чисто
frontend: eslint      чисто
```

## Живой интеграционный смоук (orchestrator, поверх агентов)
Поднял бэк (`uvicorn`, живой Postgres) отдельно от агентских прогонов:
- `GET /health` → `db:"ok"`.
- `GET /scramble` без auth-cookie ×5 → 200, разные строки, `event:"333"`.
- Схема `ScrambleOut` в `/openapi.json` подтверждена.
- Легальность: 50 запросов × 25 ходов = 1250 токенов — regex `^[URFDLB]('|2)?$` +
  проверка "нет повтора грани подряд" — 0 нарушений.

## Расхождение с планом (сознательное, MED-фикс skeptic)
Фолбэк на офлайн-скрамбл (acceptance criteria #5) реализован ДВУХСТУПЕНчато агентом:
сначала `randomScramble()+scrambleToFacelets()` (повтор серверного пути локально), при
его отказе — `randomStateFacelets()` (прямой легальный facelet-стейт без replay). План
просил один уровень фолбэка — агент добавил второй уровень как доп. защиту от двойного
отказа. Не расходится с acceptance criteria, только надёжнее.

## Осталось
- Ручной браузерный смоук (`/solo`, `/accuracy` — скрамбл из `/api/scramble` через
  Network tab) — не требует камеры, можно прогнать в preview browser, не делал в этом
  цикле (агенты подтвердили: "no visual surface — no browser verification needed",
  чисто хук/data-layer правка). Оставляю на /review, если понадобится qa-smoke.
