# Build: Vision-интеграция профилей   (slug: vision-profile-integration)

Plan: [vision-profile-integration-plan.md](vision-profile-integration-plan.md). Agent: `react-ts` (honesty-critical R1, ast-index-навигация).

## Changed files
- `vision/config.ts` — 3 новых порога (`QUICK_ADJUST_MATCH_DE`, `QUICK_ADJUST_CLUSTER_DE`, `QUICK_ADJUST_MARGIN_DE`), distinct (не оверлоад `MIN_RED_ORANGE_DE`).
- `vision/colors.ts` — von-Kries примитивы (linear-sRGB per-channel gain), `minPairwiseRefDE`.
- `vision/quickAdjust.ts` — NEW decision-layer: `observedFaceStats` (гейт на наблюдаемой белой грани) + quick-adjust решение.
- `vision/hooks/useCubeReader.ts` — `seedProfile` (validated=false) + `quickAdjust` + `seeded`/`validated`.
- `vision/hooks/useCamera.ts` — best-effort exposure/WB lock (`applyConstraints`, глотает unsupported).
- `vision/cameraErrors.ts` — NEW shared RU-ошибки камеры.
- `api/cubes.ts` — `profileToRefs`/`refsToProfile`.
- `store/cubesStore.ts` — `getSelectedProfile()` (guard на present cube).
- `solo/soloPhase.ts` — FSM порядок `loading→calibrate→walkthrough→verify→armed→solving→stopped→solve_verify→result`.
- `solo/useCalibrate.ts` — NEW sub-hook (seed-or-fallback калибровки).
- `solo/useSoloSession.ts` — seed-профиль или 6-гранный фолбэк, `quickAdjustStep`, STOPPED→SOLVE_VERIFY (эталон SOLVED), `validated` в save.
- `solo/SoloPage.tsx` — `CalibratePanel` (первый экран) + `SolveVerifyPanel`.
- `accuracy/useAccuracySession.ts` — honesty-барьер: НЕ сидит из профиля (+ регресс-тест).
- Тесты: colors (von-Kries + аддитив-регрессия + light-shift + честный red-only-fail), useCubeReader, soloPhase (новый порядок), cubesStore, accuracy-барьер.
- devDeps: `jsdom` + `@testing-library/react`/`dom` (не было DOM-test-env).

## Honesty-фиксы (skeptic HIGH) — все соблюдены + покрыты тестами
- **[HIGH#1] Мультипликативный von-Kries** в linear-sRGB, НЕ аддитивный Lab. **Регресс-тест:** аддитивный
  Lab-сдвиг оставляет `minPairwiseRefDE` неизменным (CIE76, 6 знаков) → доказывает, почему аддитив = no-op.
  Гейт «сошлось» — на **наблюдаемой** белой грани (кластер + margin), `config.DELTA_E_MODE`.
- **[HIGH#3] Белая грань (U) фиксирована** — `quickAdjust` reject → `wrong-face` если медиана 9 стикеров не U
  в пределах `QUICK_ADJUST_MATCH_DE` → полная 6-гранная перекалибровка.
- **[HIGH#2] 1 грань = глобальный white-balance, R/O не чинит** — честный тест: цвет-селективный (red-only)
  сдвиг von-Kries НЕ исправляет (задокументировано).
- **[HIGH#4] Не разблокирует ranked** — seeded+quick-adjust = `validated:false`, флаг в ResultScreen
  (casual-нота), НЕ уходит на бэк (`SolveCreate` extra=forbid). Полная 6-гранная = validated:true.
- **[LOW] Session-local** — quick-adjust мутирует refs в памяти, НЕ дёргает cubes API / PATCH.
- **[LOW] Accuracy-барьер** — `useAccuracySession` никогда не seed'ит (явный барьер + регресс-тест).

## FSM (Part C)
Порядок `CALIBRATE_SOLVED → SCRAMBLE_SHOWN → SCRAMBLE_VERIFY → READY → SOLVING → STOPPED → SOLVE_VERIFY → result`.
`calibrate_ok` — единственный выход из calibrate (таймер не взведётся без показа собранного). `solve_stop`:
solving→stopped (запись elapsed), не сразу result. `solve_verify_ok` (эталон SOLVED) → result. `again` →
calibrate (+ очистка/пере-сид refs). Timer-arm гейт + StrictMode-safe single-fire save сохранены.

## Гейты (проверено дважды: агент + main)
```
typecheck  clean (0)
test       18 files, 169 passed (+26)
lint       clean
build      ok (83 модуля)
```

## Живой смоук (main, фейк-камера/аноним)
`/solo` открывается **«Калибровка цветов» ПЕРВОЙ** (аноним → 6-гранный фолбэк «снято 0/6»), ДО walkthrough
скрамбла. Консоль чистая. Part A порядок подтверждён; anon-фолбэк корректен.

## Осталось (manual QA — реальная камера + кубики)
- Профиль (логин + кубик) → одна белая грань ~3с → honest start; не белая/другой кубик → pick-other;
  рыхлое чтение → 6-гранный фолбэк; exposure/WB-lock по браузерам.
- Accuracy-режим по-прежнему меряет свежую полную калибровку на устройстве.
- **Честностная граница:** quick-adjust-профиль помечен non-validated — ranked-гейт (accuracy перед соревновательным) реализуется в Этапе 4.
