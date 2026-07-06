# Build: Этап 0 — прототип зрения   (slug: stage0-vision-prototype)

План: [stage0-vision-prototype-plan.md](stage0-vision-prototype-plan.md).
Exec-агент: `frontend` (браузерный TS, без React). Агент оборвался на session-limit,
не докрутил typecheck/build/TODO — оркестратор довёл до зелёного (см. «Правки оркестратора»).

## Status: ✅ код готов, юнит-тесты зелёные, сборка проходит
Браузерный цикл (камера / MediaPipe / чтение кубика) — **ручная проверка ещё НЕ
проводилась** (нужен живой кубик + камера + сеть для CDN wasm/модели). Гейт точности
0.3 — впереди.

## Changed files (`prototype/`, Vite + TS vanilla-ts)
- `index.html`, `main.ts` — DOM + оркестрация мини-цикла (не юнит-тестится).
- `camera.ts` — `getUserMedia` ideal 60fps, `requestVideoFrameCallback`, один clock
  (DOMHighResTimeStamp), маппинг ошибок камеры.
- `hands.ts` — MediaPipe **HandLandmarker** (tasks-vision), landmarks/зоны/рамка,
  масштабо-инвариантная неподвижность (÷ размер руки), флип handedness для зеркала.
- `fsm.ts` — чистый КА + ABORT/reset + дебаунс на всех переходах.
- `colors.ts` — rgb2lab, ΔE **CIEDE2000** (CIE76 за флагом), медиана центр-50%,
  калибровка 6 эталонов, классификация, квоты 9×6 с пином центров.
- `cube.ts` — рамка-гид, 3×3, семпл, нормализация поворота по центру.
- `cubeState.ts` — cubejs: скрамбл, эталон facelet (**URFDLB**, задокументирован),
  diff по грани, валидация legal-строки.
- `accuracy.ts` — harness: ground truth из cubejs, per-sticker из 54 + confusion.
- `config.ts` — все пороги в одном объекте.
- `tests/{colors,fsm,cubestate}.test.ts` — Vitest.
- `cubejs.d.ts` — ambient-типы cubejs (пакет без .d.ts).
- корень `TODO.md` — чеклист Этапа 0 (Сейчас/Дальше/Бэклог).

## Правки оркестратора (агент не успел)
1. `tests/colors.test.ts` — неверный ожидаемый CIEDE2000: пара Sharma `[50,2.5,0]/
   [50,3.1736,0.5854]` даёт **ровно 1.0000** (сконструирована так), а не 1.4622.
   Реализация была верна (соседняя пара→2.0425 проходила). Исправлен литерал теста.
2. `camera.ts` — parameter-properties (`public kind`, `private video`) запрещены при
   `erasableSyntaxOnly` (шаблон Vite 8) → явные поля + присваивание.
3. `cubejs.d.ts` — добавлен (TS7016: нет деклараций).
4. `main.ts` — убран неиспользуемый импорт `rgb2lab`.
5. `hands.ts` — загрузка wasm+модели HandLandmarker переведена на CDN (пин 0.10.35)
   вместо `new URL("@mediapipe/tasks-vision/wasm", import.meta.url)` — vite не
   резолвил non-exported подпуть пакета; модель `.task` локально отсутствовала.
6. корень `TODO.md` — создан (агент не дошёл).

## api_changes
Нет — бэкенда/контрактов не касается (чистый фронт-прототип).

## tests_result
```
# cd prototype
$ npx tsc --noEmit          → exit 0 (чисто)
$ npm test  (vitest run)    → Test Files 3 passed (3) | Tests 30 passed (30)
$ npm run build (tsc && vite build) → ✓ built, exit 0
    dist/assets/index-*.js 170.11 kB │ gzip 53.56 kB
```
Юнит-покрытие (per testing-conventions): цвета/ΔE/квоты 9×6 (вкл. red↔orange),
FSM (дебаунс/500мс/ABORT), cubejs facelet-маппинг (скрамбл→строка→solvable). UI/зрение
— ручное.

## Cross-layer notes
- Рантайм требует сети: wasm `@mediapipe/tasks-vision@0.10.35` и модель
  `hand_landmarker.task` грузятся с CDN/Google-хостинга. Для оффлайна позже —
  вендорить wasm в `public/`.
- Таргет desktop Chrome (rVFC, GPU delegate). Fallback rAF есть, с пометкой о точности.

## Smoke (браузер, preview) — 2026-07-06
Поднят `npm run dev` + preview, прогнан load-time smoke (камеру/кубик headless не
проверить, но load-time баги — да). Найден и починен **реальный рантайм-баг**,
который юнит-тесты (Node) и `vite build` (не исполняет) пропустили:

- **cubejs падал при загрузке в браузере** (dev И prod): `lib/solve.js` делает
  `Cube = this.Cube || require('./cube')`. В Node `this`=module.exports; под
  Vite 8/Rolldown ESM top-level `this`=undefined → `Cannot read properties of
  undefined (reading 'Cube')` → main.ts бросал на top-level → листенеры не
  навешивались (кнопки мёртвые).
- **Fix:** `patch-package` патчит `solve.js` (`patches/cubejs+1.3.2.patch`,
  `postinstall: patch-package`) — работает и в dev-optimize, и в prod-build.
  (Первая попытка через `vite.config` `optimizeDeps.esbuildOptions.define` не
  годится: в Vite 8 опция deprecated/игнорится Rolldown и не влияет на build.)

**Проверено в браузере (dev :5173 и prod dist :4173):** страница грузится (7
кнопок, video/overlay, FSM NO_HANDS), консоль чистая, ESM-граф резолвится,
клик Start → `hands.init()` качает MediaPipe wasm+модель с CDN (jsdelivr +
googleapis `hand_landmarker.task`) → **200**, затем camera-denied обрабатывается
чисто («Camera error (denied)», кнопка re-enable). Build 0, tests 36/36.

Примечание сети: vite по умолчанию биндит только IPv6 `[::1]` — preview/curl по
IPv4 не достучались; в `launch.json` добавлен `--host 127.0.0.1`.

## Следующий шаг
`/review stage0-vision-prototype` (reviewer против плана; qa-smoke не применим — цикл
браузерный, headless не прогнать). Затем ручной прогон 0.3 и гейт ≥90%.
