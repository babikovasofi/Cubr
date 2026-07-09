# Cubr — frontend

Настоящее приложение (Этап 1). Vite + React 19 + TypeScript + **Tailwind v3**
(dark-mode `class`), react-router, Zustand. Дизайн — «Плейфул-поп» из
`.memory-bank/tech-details/design-system.md` §9.

## Запуск
```
npm install            # postinstall применяет cubejs-патч (patch-package)
npm run dev -- --host 127.0.0.1   # Vite иначе биндит IPv6; открыть http://127.0.0.1:5173
npm run typecheck      # tsc --noEmit
npm test               # vitest (перенесённая чистая логика)
npm run build          # tsc -b && vite build
```

## Статус (Этап 1.1 — каркас)
- Роуты: `/` (home-скелет + демо Button/Timer), `/solo` (заглушка — экран сборки в 1.2).
- Перенесены **чистые** модули: `src/vision/` (colors, config, fsm, cubeState, accuracy,
  guide, cubeGrid) + `src/scramble/` (walkthrough, moveCopy, cubingCdn) с их Vitest-тестами.
- DOM/эффект-части — только **хук-заготовки** (`*/hooks/`): camera/hands/cubeReader/twisty/
  scramble. Полный флоу сборки — Этап 1.2.

## Гочи (важно)
- **Tailwind пин v3.4** — design-system §9 это v3-конфиг; v4 (CSS-first) его игнорит.
- **cubejs** нуждается в патче (`patches/cubejs+1.3.2.patch` + `postinstall`) — без него
  top-level `this` крашит в браузере (build/tsc не ловят). Патч едет с проектом.
- **cubing** и **MediaPipe wasm/модель** грузятся с CDN (рантайм-зависимость от сети);
  `cubing` НЕ бандлить (Vite-воркеры), только как devDep-типы.

## История прототипов
Этап-0 rig'и `prototype/` (зрение) и `prototype2/` (скрамбл, twisty) удалены после
Этапа 1.2 — весь код перенесён в `frontend/` с тестами. Историю смотри в git до
коммита удаления. `frontend/` — единственный канон.
