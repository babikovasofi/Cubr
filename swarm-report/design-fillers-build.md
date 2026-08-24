# Build report — design-fillers

Три дизайн-филлера пустых экранов, только фронт. По плану
[design-fillers-plan.md](design-fillers-plan.md).

## Что сделано (react-ts)

Новые файлы:
- `frontend/src/lib/useSolves.ts` — общий хук `listSolves(50,0)` с
  `{kind:"loading"|"error"|"ok", solves}` + `reload()`. Устраняет дубль
  сетевой логики (была скопирована в ProfilePage History).
- `frontend/src/components/EmptyState.tsx` — переиспользуемая заглушка
  (title/description/CTA-ссылка), голос канона, без эмодзи.
- `frontend/src/components/CupsRoad.tsx` — лестница рангов. **Пороги не
  хардкодятся:** ранг/пол/остаток берутся из `UserRead.cups_rank/cups_floor/
  cups_to_next` (бэкенд — единственный источник, докстринг в `cups.py` это
  требует). Единственный фронтовый список — `name → RU-метка + accent` для
  6 рангов, помечен как зеркало порядка `CUPS_TIERS`. Канон соблюдён:
  нейтральная база, цвет кубика точечными маркерами, текущий рубеж —
  `primary`-наклейка (2px ink + shadow-sticker), трек прогресса
  `surface-2`→`primary`, ровно один 🏆 (бейдж `warning`).

Изменённые:
- `frontend/src/api/auth.ts` — в тип `UserRead` добавлены
  `cups_rank/cups_floor/cups_to_next` (бэкенд их уже отдаёт через
  `computed_field`, `schemas/user.py:50-68`).
- `frontend/src/pages/HomePage.tsx` — `Dashboard()`: секция прогресса
  (`GoalCard` + `SolveProgressChart` при наличии сборок; **одна** `EmptyState`-CTA
  на `/solo` при zero-solve, не стена карточек) + секция `CupsRoad` + `BadgeGrid`.
  Карточки-режимы остаются сверху. Всё строго внутри `Dashboard()` — гость видит
  только `Landing`.
- `frontend/src/pages/ProfilePage.tsx` — History на `useSolves()`; пустой блок
  истории и Records при `best_single_ms===null` → `EmptyState`. Inline-«—»
  (ao5/время) не тронуты (там «неприменимо», не «нет данных»).
- `frontend/src/components/SolveProgressChart.tsx` — `EmptyCard` → `EmptyState`.
- `frontend/src/profile/GoalCard.tsx` — пустой бранч на `EmptyState`
  (не откатывалось — `goals.test.tsx` зелёный).
- `frontend/src/i18n/en.ts` — новые строки.

## Тесты (vitest, jsdom+RTL)

Новые: `tests/components/EmptyState.test.tsx`, `tests/components/CupsRoad.test.tsx`,
`tests/pages/HomeDashboard.test.tsx`, `tests/profile/ProfileRecordsEmpty.test.tsx`
(exec-агент) + error-path `useSolves` (haiku).

Покрыто из Test plan: CupsRoad середина/cups=0/atMax (один 🏆, нет строки
следующего при red), Dashboard с данными → прогресс, Dashboard zero-solve → одна
EmptyState-CTA без графика, Records пусто → EmptyState, EmptyState рендерит CTA,
**гость не видит филлеров**, `useSolves` reject → error без падения, регрессия
`goals.test.tsx` зелёная.

| Команда | Результат |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | чисто |
| `npx eslint .` | чисто |
| `npx vitest run` | **1891 passed / 124 files** |
| `npm run build` | ок, бандл 268.0 kB / 320 kB |

## Кросс-слой / заметки
- Бэкенд не тронут — поля кубков уже были в `/users/me`.
- Dashboard-секция прогресса получила свой заголовок «Прогресс времени»
  (`SolveProgressChart` сам заголовка не рендерит).
- Records при пустом single: EmptyState рядом с карточкой кубков (кубки видны и
  без соло-сборок — их дают дуэли).

## Дальше
- `/review design-fillers` (опц.).
- Живой визуальный смоук на проде после деплоя (Dashboard/CupsRoad требуют
  авторизации — headless не покрывается).
