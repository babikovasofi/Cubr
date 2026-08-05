# Plan: Серверная генерация скрамблов (slug: server-scramble-generation)

## TL;DR
Переносим ГЕНЕРАЦИЮ строки скрамбла с клиента (cubing CDN `randomScrambleForEvent`)
на бэкенд: новый публичный `GET /scramble` (без авторизации — соло и accuracy-режим
работают анонимно). Скоуп сознательно узкий: **только смена источника строки**, БЕЗ
персистентности/`scramble_id`/честностной привязки solve↔scramble — это отдельный,
более поздний тикет Этапа 3 (нужна миграция `scrambles`+`solve.scramble_id`, сейчас
`SolveCreate` имеет `extra="forbid"` и такой колонки нет). Twisty-рендер (`useTwisty`)
по-прежнему грузит cubing с CDN — это НЕ убирает CDN-зависимость, только добавляет
бэкенд-зависимость для строки. Чтобы не потерять офлайн/dev-без-бэка сценарий —
клиентский фолбэк на локальный `randomScramble()` при неудаче фетча.

## Acceptance criteria
1. `GET /api/scramble` → 200, `{scramble: "R U' F2 ..."}`, БЕЗ авторизации (аноним ок).
2. Каждый сгенерированный скрамбл — валидная строка для `cubejs`: `scrambleToFacelets`
   никогда не бросает (regex `^[URFDLB]['2]?$` на токен, без двух подряд с одной гранью).
3. Соло-ритуал: текст/нотация скрамбла, twisty-walkthrough, камера-verify — работают
   как раньше, теперь на серверной строке; loading/error/retry UX сохранён.
4. Accuracy-инструмент («Известный скрамбл») по-прежнему показывает скрамбл и эталон
   facelets — общий хук `useScramble`, переключается вместе с соло.
5. **Фолбэк:** если фетч `/scramble` падает (бэк недоступен/офлайн-dev) — хук молча
   переходит на локальный `randomScramble()`+`randomStateFacelets()` из `cubeState.ts`
   (уже в репо, без CDN), не блокируя ритуал вечным "Готовлю скрамбл…". Ошибка сети не
   должна ломать локальную разработку без бэкенда.
6. cubing CDN больше НЕ используется для генерации строки (используется только для
   twisty-рендера через `useTwisty`) — регрессий рендера нет.
7. Бэк: публичный эндпоинт РЕЙТ-ЛИМИТИРОВАН (`services/ratelimit.py`, уже есть в репо)
   — паблик GET без лимита = вектор злоупотребления.
8. Тесты бэка+фронта зелёные, typecheck/lint чисты с обеих сторон.

## Plan (merged: planner + skeptic HIGH/MED, plus orchestrator fix for skeptic MED#4)

### Backend
- **`backend/app/config.py`** — `SCRAMBLE_RATE_LIMIT: str = "60/minute"` в блоке rate-limiting.
- **`backend/app/services/scramble.py`** (NEW) — чистая `random_scramble(length=25) -> str`.
  Портирует один-в-один логику TS `randomScramble()` из `frontend/src/vision/cubeState.ts`:
  грани URFDLB, суффиксы `['', "'", "2"]`, не повторять грань подряд, не давать
  редундантную пару с противоположной гранью (`opp = {U:D,D:U,R:L,L:R,F:B,B:F}`).
  Random-MOVE, не WCA random-STATE — сознательный компромисс MVP, задокументирован
  в Risks, без солвера (kociemba и т.п.) не добавляем зависимость.
- **`backend/app/schemas/scramble.py`** (NEW) — `ScrambleOut { scramble: str; event: str = "333" }`.
- **`backend/app/routers/scramble.py`** (NEW) — `APIRouter(prefix="/scramble")`,
  `GET ""` БЕЗ auth-зависимости, `Depends(ip_rate_limit(settings.SCRAMBLE_RATE_LIMIT))`.
- **`backend/app/main.py`** — зарегистрировать роутер рядом с cubes/solves.
- **`backend/tests/test_scramble.py`** (NEW):
  - `GET /scramble` → 200, непустая строка, `event=="333"`.
  - Без auth-cookie → 200 (публичный).
  - `random_scramble()` ×200: каждый токен матчит `^[URFDLB]['2]?$`, нет двух подряд
    с одной гранью (гарантия, что `scrambleToFacelets` не упадёт).
  - Два вызова дают разные строки (не константа-заглушка).

### Frontend
- **`frontend/src/api/scramble.ts`** (NEW) — `fetchScramble(signal?): Promise<string>`
  через общий `api/client.ts` (`credentials:"include"`, `/api`-база).
- **`frontend/src/scramble/hooks/useScramble.ts`** — `generateScramble()` теперь дёргает
  `fetchScramble()` вместо `loadCubing()+randomScrambleForEvent`. Сигнатура хука
  (`loading/error/retry`, cancelled-flag, facelet-мост) НЕ меняется. **[Фикс skeptic MED#4]**
  При ошибке фетча — фолбэк на локальный `randomScramble()`+`randomStateFacelets()` из
  `vision/cubeState.ts` (без сети/CDN), ритуал стартует офлайн; в `useAccuracySession`
  тот же путь. Убрать мёртвый импорт `loadCubing` (остаётся только в `useTwisty.ts` для рендера).
- **`frontend/tests/scramble/useScramble.test.ts`** (NEW, папку создать):
  - мок `fetchScramble` → резолвится строкой → хук выходит из loading, facelets посчитаны.
  - мок `fetchScramble` реджектится → фолбэк на локальный `randomScramble()`, НЕ вечный loading.
  - мок `fetchScramble` реджектится и локальный фолбэк тоже (крайний случай) → error-state,
    `retry` доступен.

## Tests
См. подробности в Plan выше (backend: test_scramble.py; frontend: useScramble.test.ts).
Прогнать: бэк `pytest`+`ruff`+`ruff format`+`mypy`; фронт `npm run test`+`tsc --noEmit`+lint.
Ручной смоук (без камеры): dev-сервер, `/solo` — скрамбл грузится из `/api/scramble`
(Network tab), walkthrough работает; `/accuracy` «Известный скрамбл» тоже.

## Blockers
Нет. Оба HIGH skeptic сняты выбором узкого скоупа (public endpoint, без persistence/id).

## Out of scope
- WCA random-STATE (нужен солвер — kociemba/twophase), сейчас random-MOVE.
- `scramble_id`/персистентность/привязка solve↔scramble (нужна миграция `scrambles`,
  снятие `extra="forbid"` с `SolveCreate` + `solve.scramble_id`) — отдельный тикет.
- Общий скрамбл для обоих игроков дуэли (Этап 4) — эта фича его НЕ закладывает.
- Событийный поток/таймстампы/кадры-доказательства/OpenCV-перепроверка (П5–П7) —
  остальная часть Этапа 3, отдельные тикеты.
- Удаление клиентского `randomScramble()` из `cubeState.ts` — остаётся как фолбэк-путь.
- Изменения UI twisty-walkthrough.

## Assumptions
- Эндпоинты монтируются в корень, фронт достаёт их через `/api`-прокси (как cubes/solves).
- В бэке нет питон-солвера кубика — не добавляем ради этого тикета.
- `useScramble` — единственный общий потребитель для соло И accuracy-режима — один свап
  переключает оба сразу, без расхождения.
