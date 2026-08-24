# Plan: Три дизайн-филлера пустых экранов (slug: design-fillers)

Frontend-only. Канон — `.memory-bank/tech-details/design-system.md` «Плейфул-поп»
(правило 90/8/2, чернильная обводка 2px + жёсткая тень, стикеры-события −6°..+6°,
один эмодзи 🏆 в бейдже кубков, поражение/пустота тихие, цвета кубика — только
точечно, крупные панели не красим).

## TL;DR

Три заглушки для пустых экранов: (1) прогресс + цели на авторизованной главной
через переиспользование `SolveProgressChart`/`GoalCard`/`BadgeGrid`; (2) новый
`CupsRoad` — лестница рангов, **питается готовыми полями бэкенда**
`cups_rank/cups_floor/cups_to_next`, а не хардкодит пороги; (3) переиспользуемый
`EmptyState` вместо голых «—» на секционных пустотах. Дубль сетевого запроса
сборок устраняется извлечением общего хука `useSolves()`.

## Acceptance criteria

1. Авторизованный на `/` (Dashboard) с засчитанными сборками видит секцию
   прогресса: `GoalCard` + `SolveProgressChart` + `BadgeGrid` — те же компоненты,
   что на профиле, без дублей кода.
2. Авторизованный **без единой сборки** (самый частый первый экран) видит **одну**
   компактную заглушку-нудж с CTA «Собери первый кубик» → `/solo`, а не стену из
   трёх пустых карточек и не вечный спиннер. Карточки-режимы (соло/дуэль/турнир)
   остаются **над** этим блоком.
3. На Dashboard есть `CupsRoad`: лестница рангов по `user.cups` — рубежи, текущая
   позиция подсвечена, назван следующий ранг и остаток кубков до него
   (`cups_to_next`); при `cups_to_next === null` (ранг red) — «все рубежи взяты»,
   без строки следующего.
4. `CupsRoad` **не содержит собственной таблицы порогов** — ранг/пол/остаток
   приходят с бэкенда (`cups_rank/cups_floor/cups_to_next`). Единственный
   фронтовый список — метки рангов (6 названий) + их accent, документирован как
   зеркало порядка `CUPS_TIERS`.
5. `CupsRoad` соблюдает канон: нейтральная база (`surface`/`surface-2`/`line`),
   цвет кубика только точечно (мини-сетка/точка у рубежа), текущий рубеж —
   наклейка (обводка 2px `ink` + `shadow-sticker`), трек прогресса `surface-2` с
   заливкой `primary`, ровно один 🏆, нет цветного текста на цветной заливке,
   ≤2 ярких цвета кубика в компоненте.
6. `EmptyState` (новый общий компонент) заменяет **секционные** пустоты: пустая
   история сборок (`ProfilePage` 302–313), пустой график (`SolveProgressChart`
   EmptyCard), пустые «Рекорды» при `best_single_ms === null`. Inline-«—»
   (ячейки времени/ao5) **не трогаем** — там «—» значит «неприменимо», не «нет
   данных».
7. `EmptyState` рендерит заголовок + текст + CTA-ссылку когда данных нет; когда
   данные есть — просто не монтируется (проверяемо на уровне страниц).
8. Копирайт в голосе канона: без сюсюканья, без россыпи эмодзи, без запрещённых
   слов; поражение/пустота тихие.
9. Ни один филлер не протекает в гостевой `Landing` — всё внутри `Dashboard()`.

## Plan

### Разрешение конфликта планировщик↔скептик (важно)
Бэкенд — **единственный источник** лесенки кубков: `backend/app/services/cups.py`
`CUPS_TIERS` (white/yellow/green/blue/orange/red, полы 0/100/300/600/1000/1500),
выставлен как `computed_field` на `UserRead` — `cups_rank`, `cups_floor`,
`cups_to_next` (`backend/app/schemas/user.py:50-68`). Докстринг: «фронт никогда не
дублирует лесенку». Планировщик ошибочно предложил клиентский `profile/cups.ts` —
**отклонено**. Фронт добавляет три поля в свой тип `UserRead` и потребляет их.

### Шаги + affected_files

1. **`frontend/src/api/auth.ts`** — добавить в тип `UserRead`:
   `cups_rank: string`, `cups_floor: number`, `cups_to_next: number | null`.
   (Сейчас есть только `cups: number`.) Бэкенд уже их отдаёт.
2. **`frontend/src/lib/useSolves.ts`** (НОВЫЙ) — хук: `listSolves(50, 0)`,
   состояние `{kind:"loading"|"error"|"ok", solves}` + `reload()`. Извлечь логику
   из инлайна `ProfilePage.tsx` History (247–268).
3. **`frontend/src/components/EmptyState.tsx`** (НОВЫЙ) — пропсы `title: string`,
   `description?: string`, `ctaLabel?: string`, `ctaTo?: string`,
   `illustration?: ReactNode` (дефолт — паттерн-сетка §8: одинокая плитка accent).
   Канон: `rounded-lg border-2 border-ink bg-surface p-6` (или `border-line` для
   тихих), CTA — `Link` `font-bold text-primary` «… →». Без эмодзи.
4. **`frontend/src/components/CupsRoad.tsx`** (НОВЫЙ) — презентационный, читает
   `user` из `useAuthStore` (`cups`, `cups_rank`, `cups_floor`, `cups_to_next`;
   доп. запроса нет). Метки рангов — локальный map `{white:"Белый", ...}` +
   accent-цвет для мини-сетки, с комментарием «зеркало порядка CUPS_TIERS».
   Прогресс в текущем ранге = `(cups - cups_floor) / ((cups + cups_to_next) -
   cups_floor)` (при `cups_to_next===null` → 1, atMax). Рендер: список рубежей с
   MiniGrid-маркерами, текущий — наклейка (`primary` + 2px `ink` +
   `shadow-sticker`), пройденные/будущие — `surface-2`/`line`; трек прогресса;
   бейдж «🏆 {cups}» один раз.
5. **`frontend/src/pages/HomePage.tsx`** `Dashboard()` — подключить `useSolves()`:
   - `ok && solves.length>0` → секция прогресса `GoalCard` + `SolveProgressChart`.
   - `ok && 0` (или loading) → **одна** `EmptyState` (nudge → /solo), НЕ три
     пустые карточки.
   - Секция `CupsRoad` + `BadgeGrid`. Карточки-режимы остаются сверху.
   Импорты: `GoalCard`, `SolveProgressChart`, `BadgeGrid`, `CupsRoad`,
   `EmptyState`, `useSolves`. Всё строго внутри `Dashboard()`, не в общем теле
   `HomePage` (гость не должен видеть).
6. **`frontend/src/pages/ProfilePage.tsx`** — History на `useSolves()` (убрать
   инлайн-fetch, поведение то же); пустой блок 302–313 → `<EmptyState/>`;
   Records при `best_single_ms===null` → `<EmptyState/>` (CTA /solo) вместо грида
   «—/—». `fmtMs` и inline-«—» (стр. 29, 140) **не трогать**. Никакого рестайла
   существующих секций сверх этого.
7. **`frontend/src/components/SolveProgressChart.tsx`** — `EmptyCard()` →
   `<EmptyState/>` (устранить дубль). `buildChartModel` и SVG не трогать.
8. **`frontend/src/profile/GoalCard.tsx`** — пустой бранч (`bestMs===null`) на
   `EmptyState` **опционально**; если это ломает `tests/profile/goals.test.tsx` —
   откатить, оставить как есть (не блокер).

### Порядок исполнения
auth.ts → useSolves → EmptyState → CupsRoad → HomePage Dashboard → ProfilePage →
SolveProgressChart. Typecheck + vitest + визуальная проверка обоих состояний.

## Test plan (vitest, jsdom+RTL; фабрика solve() как в tests/profile/goals.test.tsx)

**Happy path**
- `tests/components/CupsRoad.test.tsx` — cups в середине лесенки (напр. rank
  "green", floor 300, to_next 300): виден текущий ранг, следующий рубеж и остаток
  кубков; ровно один символ 🏆 в разметке.
- `tests/pages/HomeDashboard.test.tsx` — authed + непустые solves (мок
  `api/solves.listSolves`, `api/badges.getBadges`, authStore authed): Dashboard
  показывает прогресс (заголовок «Цель» и/или «Прогресс времени»).

**Границы / edge**
- `CupsRoad`: cups=0 → первый ранг (white), `cups_to_next>0`, прогресс от нуля,
  не atMax. cups за максимумом (`cups_to_next===null`, rank "red") → «все рубежи
  взяты», строки следующего рубежа нет, прогресс=1.
- `HomeDashboard`: authed + **пустые** solves → одна `EmptyState`-CTA на /solo,
  график НЕ показан; и не три отдельные пустые карточки.
- `tests/profile/ProfileRecordsEmpty.test.tsx` — `best_single_ms===null` →
  `EmptyState` (CTA /solo), не грид «—»; при заданном best — грид со значением.
- `tests/components/EmptyState.test.tsx` — рендерит title/description/CTA когда
  переданы; `getByRole('link')` href = ctaTo (`/solo`).

**Error / regression**
- Гостевой `HomePage` (authStore не authed) → не рендерит ни `CupsRoad`, ни
  прогресс, ни Dashboard-`EmptyState` (только Landing).
- `useSolves`: `listSolves` reject → состояние `error`, страница не падает.
- Существующие `tests/profile/goals.test.tsx` и текущие тесты ProfilePage/History
  остаются зелёными (рефактор History на хук не меняет поведения).
- Мок сети в page-тестах: `vi.mock('../../src/api/solves')` и
  `vi.mock('../../src/api/badges')`, иначе BadgeGrid бьёт в сеть.

## Blockers
Нет. Оба HIGH скептика решены в плане (CupsRoad от бэкенд-полей; общий `useSolves`).

## Out of scope
- Любые бэкенд-изменения (ранги/пороги/начисление уже готовы).
- Анимации начисления кубков — только статичная лестница.
- Перенос/дубль `CupsRoad` на ProfilePage.
- Рестайл существующих секций профиля, Records-грида, History-таблицы сверх
  замены пустых блоков на `EmptyState`.
- Пагинация/новый эндпоинт истории — только существующий `listSolves(50,0)`.
- Матчмейкинг, новые режимы, лидерборды.

## Assumptions
- `cups_rank/cups_floor/cups_to_next` уже в ответе `/users/me` (проверено в
  `schemas/user.py:50-68`) — фронт лишь добавляет их в свой тип.
- «Нет активности» на Dashboard = `listSolves` пуст (или только DNF) — тот же
  критерий, что у `GoalCard`/`SolveProgressChart`.
- `BadgeGrid` переиспользуем как есть (сам фетчит `GET /badges`).
- Метки рангов (RU-названия 6 цветов) — фронтовый текст поверх бэкенд-`cups_rank`;
  не бизнес-логика, разъехаться нечему (пороги на бэке).
