# Build: Этап 1.2 — соло-экран, **Slice A**   (slug: stage1-solo)

План: [stage1-solo-plan.md](stage1-solo-plan.md). Exec: react-ts (агент упал на
session-limit, но дописал код Slice A; оркестратор довёл гейты до зелёного).

## Status: ✅ Slice A verified (typecheck 0, lint 0, tests 64/64, build 0, браузерный smoke)
Полный ритуал с реальной камерой/руками — **ручная QA пользователя** (headless камеру не гоняет).

## Что в Slice A (камера + hands + FSM + таймер в React)
- `src/vision/hooks/useCamera.ts` — порт Camera: getUserMedia 60fps, rVFC-loop (fallback rAF),
  `nowTs`=DOMHighResTimeStamp, stop() тушит треки+srcObject+loop. CameraError по kind.
- `src/vision/hooks/useHands.ts` — порт Hands: MediaPipe HandLandmarker (CDN wasm/model 0.10.35),
  detect→HandObservation (bothInZone, масштабо-инвариантная неподвижность, handsOutOfZone),
  drawOverlay, defaultZones. init() идемпотентен, close() освобождает. HandsInitError.
- `src/vision/components/CameraStage.tsx` — `<video>` (CSS scaleX(-1)) + оверлей-canvas + work-canvas.
- `src/pages/SoloPage.tsx` — оркестратор: онбординг + «Включить камеру» жест; единый mount-эффект
  (камера+hands, **StrictMode async-cancellation**); стабильный onFrame (refs-only) → detect →
  чистый `fsm.step` → **таймер в DOM-node** (single clock nowTs) → drawOverlay; публикация FSM-стейта
  на переходе (lastGuideKey-гейт). solve_stop → запись времени + fsm.reset (без заклина). RU-ошибки+retry.
- `src/components/Timer.tsx` — расширен: `valueRef` для per-frame DOM-записи; phase→точка; timer-lg/md.
- `src/vision/time.ts` (+тест) — чистый `fmtSec` форматтер.

## Паттерны (skeptic HIGH) — соблюдены (проверено чтением SoloPage)
- StrictMode: `let cancelled`; проверка после каждого await; cleanup тушит stream/landmarker;
  resolve-after-cleanup → немедленный teardown. Одна камера при двойном маунте.
- Hot-loop только refs (sessionRef), стабильный useCallback; publish на переходе, не 60×/с.
- Таймер в DOM-node по ref, НЕ setState; один clock (rVFC nowTs) кормит и таймер, и fsm.step.
- Камера один раз (armed), release на unmount. fsm.ts переиспользован без правок.

## Правки оркестратора (после падения агента)
- `time.ts`: `fmtSec` округлял не туда на граничном 1234.5мс (float 1.2345≈1.23449) → `Math.round(ms)` до мс.
- `eslint.config.js`: не было TS-парсера (espree давился `type`-импортами) → добавлен `typescript-eslint`
  parser; отдельный commonjs-блок для `tailwind.config.js`. Lint 0.

## tests_result
```
npm run typecheck → 0
npm run lint      → 0
npm test          → Test Files 7 passed | Tests 64 passed (64)  (+3 fmtSec)
npm run build     → 0 (js 365 kB — MediaPipe теперь в бандле)
```

## Браузерный smoke (dev :5175, без реальной камеры)
`/solo` рендерит онбординг («Соло — сборка» + «Что нужно» + «Включить камеру»). Клик → в headless
камеры нет → чистый error-путь: `cameraDeniedRu` alert + «Попробовать снова» (role=alert), без краша.
MediaPipe-init прошёл (различение camera/model-ошибок работает). Консоль чистая. StrictMode-safe.

## Осталось (ручная QA + следующие слайсы)
- **Ручная QA Slice A** (нужна живая камера + руки): руки в зоны→READY→убрал→таймер→вернул→стоп;
  один поток камеры при StrictMode; release при уходе с /solo; дважды подряд без перезагрузки.
- **Slice B** (калибровка+чтение+verify) · **C** (скрамбл+twisty walkthrough) · **D** (результат+guide).
