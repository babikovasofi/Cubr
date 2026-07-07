# Plan: Этап 1.1 — каркас фронтенда + порт модулей   (slug: stage1-frontend)

> planner + skeptic (оркестратор вручную). Skeptic verdict = **revise** (5 HIGH);
> все вложены ниже. Ветка `stage-1-frontend`.

## TL;DR
Настоящее приложение в `frontend/`: **Vite + React 19 + TS + Tailwind v3** (dark
class), react-router (`/`, `/solo` заглушка), дизайн-токены из design-system.md §9,
Zustand. Порт **чистых** модулей зрения (`prototype/`) и walkthrough (`prototype2/`)
с их Vitest-тестами; DOM/эффект-модули (камера/hands/twisty) — только хук-заготовки.
Две токен-проверочные UI (Button §5.1, статичный Timer §3). **Scope = 1.1 скелет**,
полный соло-флоу = 1.2 (отдельный план). Прототипы **не трогаем** (заморожены).

## Key decisions (skeptic HIGH)
1. **Tailwind = v3 (пин `tailwindcss@^3.4` + postcss + autoprefixer).** design-system
   §9 — v3 JS-конфиг (`module.exports`, `@tailwind` директивы). «latest» = v4 (CSS-first
   `@theme`, `@tailwindcss/vite`) — вставка v3-конфига туда молча не применится/сломается.
   Пиним v3 → спека §9 ложится дословно, ноль риска перевода токенов. v4-миграция —
   отдельный будущий пункт, не сейчас.
2. **cubejs-патч едет ТРОЙКОЙ** (skeptic HIGH2, краш только в рантайме — tsc/build его
   не видят): `frontend/patches/cubejs+1.3.2.patch` + `postinstall:"patch-package"` +
   devDep `patch-package` + dep `cubejs`. **Проверка:** `npm i` печатает «patch-package:
   applied», затем загрузить страницу, импортящую `cubeState`, в **DEV** (не только build).
3. **Purity — точный список** (skeptic HIGH3): чистые (портятся как есть) = `colors`,
   `fsm`, `config`, `guide`, + `walkthrough`, `moveCopy`. cubejs-bound (нужен патч) =
   `cubeState`, `accuracy`. `cube.ts` НЕ чистый (canvas) → расщепить: чистые grid-функции
   (`rotateGrid/normalizeByRotation/assignFacesByCenter/resolveRotations`) → `cubeGrid.ts`;
   canvas-читалки (`readFace/guideRegionLuma`, getImageData) → в хук `useCubeReader`.
4. **`config.ts` — обязателен в порте** (skeptic HIGH4; жёсткая зависимость colors/fsm/
   cubeGrid/accuracy). В нём 1 ссылка на window/document → **загард** (`typeof`-чек / ленивый
   доступ), иначе падает в Vitest node-env при импорте.
5. **Импорты без `.ts`** (skeptic HIGH5): прототипы используют явные `./x.ts` специфаеры
   (bundler-режим + allowImportingTsExtensions). В `frontend` — **срезать `.ts`** во всех
   портируемых импортах (чище для долгоживущего app), tsconfig strict+bundler. `erasableSyntaxOnly`
   сохранить (без enum/namespace).

## Acceptance criteria (наблюдаемо)
1. `cd frontend && npm install` — успех; postinstall применяет cubejs-патч (нет top-level-`this`
   краша в dev/build).
2. `npm run dev -- --host 127.0.0.1` — `/` рендерит home-скелет, `/solo` — заглушку
   («Соло — экран сборки в 1.2»); клиентская навигация react-router.
3. `npm run build` (tsc + vite build) чисто; `npm run typecheck` чисто.
4. Токены применены: CSS-vars light + `.dark` на `<html>`, Rubik + IBM Plex Mono грузятся;
   тумблер темы (Zustand) меняет палитру вживую (ручная QA).
5. Button = §5.1 (bg-primary, 2px ink-рамка, radius full, hover `translate(-2px,-2px)`+
   shadow-sticker, focus-ring, disabled). Timer = §3 T1 **статично**: Rubik 900,
   tabular-nums, ink-цифры «0.00», цветная точка (статичный цвет фазы) — **без** count-drop/
   confetti/phase-машины (skeptic MED — те в 1.2).
6. Чистые модули под `frontend/src/vision/` (colors, fsm, config, cubeState, accuracy, guide,
   cubeGrid) и `frontend/src/scramble/` (walkthrough, moveCopy, cubingCdn).
7. Все портированные Vitest зелёные, **счётчик сохранён**: vision colors/cubestate/fsm/guide
   (было 36 в prototype) + scramble moveCopy/walkthrough (было 9 в prototype2).
8. DOM/эффект — только React-хук-заготовки (`useCamera/useHands/useCubeReader/useTwisty/
   useScramble`): компилируются/typecheck, но полного экрана сборки НЕТ. **twisty-player НЕ
   монтируется** в `/solo`-заглушке (StrictMode-двойной-маунт — забота 1.2).
9. `prototype/` и `prototype2/` не изменены; помечены frozen (README-нотой) — frontend канон
   для чистых модулей, дубли живут до 1.2 (skeptic MED: freeze против дрейфа).

## Affected files (frontend/)
Каркас: `package.json` (scripts dev/build/preview/test/typecheck/**postinstall**; deps
react@19, react-dom, react-router-dom@6, zustand, `cubejs@^1.3.2`, `@mediapipe/tasks-vision@^0.10.35`;
devDeps vite@^8, @vitejs/plugin-react, typescript, vitest@^4, **tailwindcss@^3.4**, postcss,
autoprefixer, **patch-package**, `cubing` (пин, только типы), eslint, prettier), `vite.config.ts`
(plugin-react; `server.host:"127.0.0.1"`; vitest node-env), `tsconfig.json` (strict, bundler,
react-jsx, paths `@/*`), `index.html`, `.gitignore`, `.eslintrc.cjs`, `.prettierrc`, `README.md`.
Патч: `patches/cubejs+1.3.2.patch` (копия из prototype/).
Токены: `tailwind.config.js` (**дословно §9**, darkMode 'class'), `postcss.config.js`,
`src/index.css` (`@tailwind` слои + `:root`/`.dark` CSS-vars + `@import` шрифты + `::selection`
дословно §9).
Приложение: `src/main.tsx` (createRoot + BrowserRouter + index.css), `src/App.tsx` (Routes,
минимальный 48px header-shell §6, **словомарк «Cubr»** — не «CubeDuel»; макет со старым именем),
`src/pages/HomePage.tsx` (скелет + демо Button/Timer), `src/pages/SoloPage.tsx` (заглушка),
`src/components/Button.tsx`, `src/components/Timer.tsx`, `src/store/uiStore.ts` (Zustand theme +
toggle `.dark` на documentElement).
Порт vision → `src/vision/`: colors, config (загард window), fsm, cubeState, accuracy, guide,
cubeGrid (чистые grid-функции из cube.ts). Хук-заготовки `src/vision/hooks/`: useCamera, useHands
(MediaPipe CDN 0.10.35), useCubeReader (canvas readFace/guideRegionLuma).
Порт scramble → `src/scramble/`: walkthrough, moveCopy, cubingCdn (CDN-лоадер, НЕ бандлить).
Хук-заготовки `src/scramble/hooks/`: useTwisty (ref-based mount), useScramble.
Тесты → `frontend/tests/`: vision/{colors,cubestate,fsm,guide}.test.ts, scramble/{moveCopy,
walkthrough}.test.ts (импорты перенаправить, `.ts` срезать).

## Steps
1. Scaffold `frontend/` (Vite React-TS), vite.config `server.host=127.0.0.1`, eslint/prettier/gitignore.
2. Патч: копировать `cubejs+1.3.2.patch`, добавить patch-package + postinstall + cubejs dep; `npm i` → убедиться «applied».
3. Токены: `tailwind.config.js` дословно §9, postcss, `index.css` (слои + vars + шрифты). **Пин Tailwind v3.** Проверить что класс токена (`bg-primary`, `shadow-sticker`) реально рендерится.
4. Роутинг: App.tsx `/`→HomePage, `/solo`→SoloPage-заглушка; header-shell §6, словомарк «Cubr».
5. Zustand `uiStore` тема → `.dark` на `<html>`; тумблер на HomePage.
6. Порт чистых vision (colors/config/fsm/cubeState/accuracy/guide) + `cubeGrid.ts` (чистые из cube.ts); срезать `.ts` в импортах; загард config.
7. Хук-заготовки vision (useCamera/useHands/useCubeReader) — сигнатуры+lifecycle, без экрана.
8. Порт чистых scramble (walkthrough/moveCopy) + cubingCdn (CDN, не бандлить); хук-заготовки useTwisty/useScramble.
9. Button (§5.1) + Timer (§3 T1 статичный) на токенах; демо на HomePage.
10. Портировать тесты в `frontend/tests/**` (пути/расширения); Vitest node-env; `npm test` — тот же счётчик зелёный.
11. `npm run typecheck` + `npm run build`; `npm run dev -- --host 127.0.0.1` — ручная QA (/, /solo, light+dark, Button/Timer).
12. README: dev-нота (`--host 127.0.0.1`), CDN-net-deps (cubing + MediaPipe), Tailwind v3-нота. Заморозить prototype/prototype2 нотой.

## Tests
Vitest (node-env) на портированной чистой логике: colors (Lab/ΔE/CIEDE2000/квоты), cubestate
(validate/solvability — прогоняет cubejs+патч), fsm (переходы/дебаунс), guide (state+copy),
moveCopy (токен→RU), walkthrough (шаг-машина). Счётчик = как в прототипах. `tsc --noEmit` чисто.
`vite build` чисто (подтверждает патч в прод-бандле). Браузерный рендер токенов/Button/Timer —
ручная QA (headless не гейт).

## Blockers
Нет открытых. Tailwind v3-пин решён (см. Key decisions #1) — если захочешь v4, это отдельная
миграция позже. Внутренний гейт: если после патча `cubeState` всё же крашит в браузере — стоп,
разобрать (как с прошлым cubejs), не пропихивать.

## Out of scope
Полный соло-флоу/ритуал (userflow §5.1) = **1.2**; живая камера/hands/twisty в рабочем экране;
UX генерации скрамбла, экран результата, экраны ошибок камеры (1.2); бэкенд/аккаунты/БД/WS/дуэли/
турниры/серверный скрамбл (Этапы 2+); полная библиотека компонентов §5–§7 и анимации сверх
Button+Timer; переименование словомарка в макетах/домен (брендинг-бэклог); прохождение гейта
Этапа 0.3 (пререквизит, отдельно).

## Assumptions
- npm (не pnpm) — под package-lock/patch-package прототипов. React 19 + react-router-dom v6 +
  zustand v4/5 (latest stable).
- Vitest node/happy-dom для чистой логики; @testing-library/jsdom добавить, но компонентные
  тесты — 1.2 (браузерный рендер = ручная QA).
- `guide` и `accuracy` портируются как чистые (guide имеет тест; accuracy без теста в прототипе).
- Прототипы остаются runnable для ручных vision/scramble-спайков до 1.2, под freeze (no edits).
- Словомарк «Cubr» (макет §6 показывает старое «CubeDuel»).
