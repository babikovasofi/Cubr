# Build: Этап 1.2 — соло-экран сборки   (slug: stage1.2-solo-screen)

Plan: [stage1.2-solo-screen-plan.md](stage1.2-solo-screen-plan.md). Agent: `react-ts` (single scope — весь фичер фронтовый).

## Changed files
| File | Change |
|---|---|
| `frontend/src/vision/hooks/useCamera.ts` | порт Camera + StrictMode/rVFC-safe хук |
| `frontend/src/vision/hooks/useHands.ts` | порт HandLandmarker (`numHands:2`, `runningMode:"VIDEO"`), `.close()` |
| `frontend/src/vision/hooks/useCubeReader.ts` | + inline quick-calibrate + 6-face verify-коллектор |
| `frontend/src/vision/overlay.ts` | NEW — `drawOverlay` + `defaultZones` (сплит из useHands) |
| `frontend/src/scramble/hooks/useTwisty.ts` | ref-mount `<twisty-player>`, `showState`/`animateMove` |
| `frontend/src/scramble/hooks/useScramble.ts` | один скрамбл/mount + `parseMoves` + facelet-мост |
| `frontend/src/solo/soloPhase.ts` | NEW — чистый reducer фаз (гейт таймера + `start_t`/`stop_t`) |
| `frontend/src/solo/useSoloSession.ts` | NEW — per-frame оркестратор camera→hands→fsm→timer |
| `frontend/src/solo/ScrambleWalkthrough.tsx` | NEW — twisty + moveCopy + прогресс/мини-карта/клавиши/нотация |
| `frontend/src/solo/CameraStage.tsx` | NEW — зеркальное видео+оверлей, скрытый work-canvas |
| `frontend/src/solo/ResultScreen.tsx` | NEW — фикс.время / DNF + «ещё раз» |
| `frontend/src/pages/SoloPage.tsx` | заменена заглушка; phase-driven композиция |
| `frontend/tests/solo/soloPhase.test.ts` | NEW — переходы reducer + гейт + start/stop |
| `frontend/tests/scramble/scrambleParse.test.ts` | NEW — parseMoves + мост cubing→cubeState |
| `.claude/launch.json` | + "frontend" dev-server для preview |

## Tests (проверено дважды: агент + main)
```
typecheck: PASS  (tsc --noEmit -p tsconfig.app.json, 0 ошибок)
test:      PASS  Test Files 8 passed (8) · Tests 73 passed (73)  [+12 новых: 8 soloPhase + 4 scrambleParse]
lint:      FAIL  — PRE-EXISTING infra, НЕ дефект этого среза
```
Lint сломан repo-wide: `frontend/eslint.config.js` без TypeScript-парсера → espree
«Parsing error: Unexpected token» на КАЖДОМ `.ts/.tsx`. На чистом HEAD (git stash -u) —
**28 таких ошибок до наших правок**. Только missing-parser, не нарушения правил.
Background-task `task_83318b2d` — подключить `typescript-eslint`.

## Skeptic-констрейнты — все соблюдены
- StrictMode: `cancelled`-флаги + идемпотентные `stop()`/`close()`; unmount-cleanup эффект.
- rVFC: id хранится + `cancelVideoFrameCallback` + `running`-флаг + bail `readyState<2` + rAF fallback.
- Таймер гейт: reducer `solve_start` только в фазе `armed` (после `scrambleVerified`).
- Elapsed = `stopT − startT` из `o.t` кадров (никакого `performance.now()` в хендлере).
- Mirror: только CSS `scaleX(-1)`; выборка/оверлей в raw-координатах.
- cubing CDN: loading/error/retry UI.
- Все файлы < 400 строк. Ported-модули переиспользованы, не дублированы.

## Осталось (manual QA — не автоматизируется headless)
- Реальная камера + физический кубик, полный ритуал §5.1: landmarks/зоны-оверлей, twisty-анимация,
  6-face verify, таймер по рукам.
- StrictMode ×2 живьём → один стрим/player/landmarker.
- `twisty animateMove` использует опц. `jumpToStart`/`play` на CDN-плеере — проверить в реальном браузере.
- Smoke в песочнице: `/solo` монтируется под StrictMode без console-ошибок; CDN-воркер заблокирован →
  корректно показал scramble-error+retry (без краша).

## Deviation
Reducer схлопывает `stopped`→`result` в один переход `solve_stop→result` (тесты под это написаны);
все поведения плана (verify-mismatch держит таймер невзведён, abort DNF/re-arm, again→свежий цикл) покрыты.
