# Build: Этап 1.1 — каркас фронтенда   (slug: stage1-frontend)

План: [stage1-frontend-plan.md](stage1-frontend-plan.md). Exec: `frontend` (агент упал
на session-limit после scaffold; оркестратор довёл порт/тесты/фиксы до зелёного).

## Status: ✅ verified (typecheck 0, tests 61/61, build 0, браузерный smoke)

## Что сделано
- **Каркас** `frontend/`: Vite + React 19 + TS + **Tailwind 3.4** (dark class), react-router
  (`/`, `/solo`-заглушка), Zustand (тема → `.dark` на `<html>`), eslint/prettier.
- **Токены** design-system §9: `tailwind.config.js` дословно, `index.css` (CSS-vars light/.dark
  + Rubik/IBM Plex Mono + ::selection). Проверено: `bg-primary`→#0051BA, dark bg→#232019.
- **cubejs-патч** переехал тройкой (patch + postinstall + patch-package) → `npm i` печатает
  «cubejs@1.3.2 ✔»; в браузере top-level-`this` НЕ крашит (консоль чистая).
- **Порт чистых модулей** → `src/vision/` (colors, config, fsm, cubeState, accuracy, guide,
  cubeGrid + cubejs.d.ts) и `src/scramble/` (walkthrough, moveCopy, cubingCdn). Импорты без `.ts`.
- `cube.ts` расщеплён: чистый `cubeGrid.ts` + canvas-читалки в `hooks/useCubeReader.ts`.
- **Хук-заготовки** (stubs, 1.2): useCamera, useHands, useCubeReader, useTwisty, useScramble.
- **UI:** `Button` (§5.1) + статичный `Timer` (§3 T1) на токенах; демо на HomePage.
- **Тесты перенесены** → `frontend/tests/` (6 файлов) с исправленными путями.

## Правки оркестратора (после падения агента)
- Порт fsm/cubeState/accuracy/guide/cubeGrid/scramble + хуки + тесты (агент успел только scaffold + colors/config).
- Добавлен `cubejs.d.ts` (не был портирован) → ушли TS7016 + co/eo any.
- Убран `erasableSyntaxOnly` из tsconfig.app+node (TS ~5.6 не поддерживает).
- `tsconfig.node`: `types:["node"]` + devDep `@types/node` → vite.config `node:url`/`import.meta.url`.
- **Тесты перекопированы байт-безопасно (bash+sed)** — PowerShell-переписка испортила кириллицу (мойибаке).

## tests_result
```
npm install       → patch-package: cubejs@1.3.2 ✔ ; Tailwind 3.4.19
npm run typecheck → exit 0
npm test          → Test Files 6 passed | Tests 61 passed (61)
npm run build     → exit 0 (js 216 kB, css 10 kB)
```

## Браузерный smoke (dev :5175)
`/` рендерит: «Cubr» wordmark, таймер T1 «0.00»+жёлтая точка, Button primary, disabled,
кремовый фон. Тумблер темы → `.dark` + тёмная палитра (#232019). `/solo` — заглушка «в 1.2».
Консоль без ошибок (cubejs-патч рантайм-safe). Токены применяются (v3-конфиг работает).

## Известные мелочи (не блокеры)
- Подпись кнопки темы не обновляется («Тема: светлая» в обоих состояниях) — косметика демо-home.
- `@mediapipe/tasks-vision` в devDeps (используется только в стаб-хуке; в 1.2 → dep).
- npm audit: 40 vuln в дев-зависимостях — разобрать позже.

## Осталось (вне 1.1)
Полный соло-флоу сборки (камера/hands/twisty live) = **Этап 1.2**. Прототипы заморожены
(frontend — канон чистых модулей).
