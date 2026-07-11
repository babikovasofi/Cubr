# Build: Этап 0.3 — режим замера точности зрения   (slug: stage0.3-accuracy-gate)

Plan: [stage0.3-accuracy-gate-plan.md](stage0.3-accuracy-gate-plan.md). Agent: `react-ts` (frontend + docs).

## Changed files
- `frontend/src/vision/accuracyRun.ts` — NEW чистый accumulator (assembleRawRead, per-condition merge, Wilson-LB, min-over-conditions, hotspots).
- `frontend/src/vision/hooks/useCubeReader.ts` — +`resolveSixFaces` helper, accuracy-collector (`pushAccuracyFace` отдаёт **сырые** argmin-грани до resolve); verify не изменён.
- `frontend/src/accuracy/useAccuracySession.ts` — NEW оркестратор (камера+overlay+reader+scramble).
- `frontend/src/accuracy/AccuracyControls.tsx`, `AccuracyPage.tsx` — NEW панель + композит (CameraStage as-is).
- `frontend/src/App.tsx` — `/accuracy` роут **dev-only** (`import.meta.env.DEV` + `React.lazy`).
- `frontend/src/pages/HomePage.tsx` — dev-only entry-link.
- `frontend/tests/vision/accuracyRun.test.ts` (12) + `accuracy.test.ts` (9) — NEW.
- `docs/qa/stage-0.3-vision-accuracy.md` — NEW протокол ручного QA (RU).
- `.memory-bank/tasks/README.md` — гейт 0.3 слинкован с инструментом + протоколом.

## Skeptic-констрейнты — соблюдены
- **Сырое чтение, не resolved** (`assembleRawRead` конкатенит фикс-порядок argmin-граней → 54-URFDLB; `scoreRead(raw, truth)`). Анти-survivorship.
- **Фикс-порядок/ориентация** захвата (U,R,F,D,L,B, «белый верх/зелёный к себе») — выравнивание известно априори, не выводится из чтения.
- `accuracy.ts` **не тронут** (импорт `scoreRead`/`formatReport`).
- **Гейт = min-over-conditions**: FAIL если хоть одно условие не даёт `Wilson-LB ≥0.90 И nScored≥20 И dropRate≤0.15`. Тест: point-estimate 90% корректно FAIL-ит.
- **Dropped/illegal** считаются в знаменателе (+гистограмма причин).
- `CENTER_DRIFT_DE` enforced per-face; провенанс калибровки в condition-теге.
- Ground truth независим: known-scramble (`scrambleToFacelets`, primary) / SOLVED (санити).
- **Hotspots** red↔orange / white↔yellow с N.

## Tests (проверено дважды: агент + main)
```
typecheck  clean (0)
test       16 files, 141 passed (+21: accuracyRun 12 + accuracy 9)
lint       clean
build      ok · /accuracy НЕ в прод-бандле (dev-only tree-shaken) — grep dist/ пусто
```

## Осталось — сам гейт (manual, это и есть deliverable-доказательство)
Автотесты доказывают математику accumulator/assembler. **Реальный гейт ≥90%** гоняет человек по
[docs/qa/stage-0.3-vision-accuracy.md](../docs/qa/stage-0.3-vision-accuracy.md): 3 света × ≥2 кубика ×
1–2 человека, ≥20 чтений/условие, min-over-conditions Wilson-LB ≥90% + drop-rate. Запуск: `npm run dev`
во `frontend/` → `/accuracy` (dev-only). FAIL → **СТОП, пересмотр зрения (R1)**.
Живой браузер-смоук самого экрана не делался (нужен `getUserMedia` + физический кубик).
