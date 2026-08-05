# Plan: Vision-интеграция профилей кубиков   (slug: vision-profile-integration)

## TL;DR
Соло-ритуал потребляет сохранённый профиль выбранного кубика + быстрая подстройка **одной белой
гранью** (~3с) вместо полной 6-гранной калибровки, и порядок ритуала правится по Part A
(собранный кубик ПЕРВЫМ, до скрамбла). **Честностный контур (утв. решение):** quick-adjust — только
**casual-solo**; он НЕ валидирует red/orange (одна грань физически не может), поэтому профиль после
quick-adjust помечается `not accuracy-validated`, и соревновательный таймер (Этап 4) потребует
полного чтения / accuracy-гейта. Полная калибровка и accuracy-режим не трогаются.

## Ключевые честностные фиксы (skeptic HIGH — иначе фича подрывает R1)
- **[HIGH#1] Мультипликативная von-Kries коррекция, НЕ аддитивный Lab-сдвиг.** Аддитивный сдвиг ко
  всем 6 эталонам — жёсткий перенос → все попарные ΔE сохраняются → гейт «сошлось» = no-op. Коррекция
  = per-channel gain в **linear-sRGB** по белой грани. **Гейт «сошлось» считается на НАБЛЮДАЕМЫХ данных
  грани** (тесная кластеризация 9 стикеров + уверенный single-ref матч), НЕ на сдвинутых эталонах.
- **[HIGH#2] Одна грань = глобальный white-balance, R/O не валидирует.** Явно принимаем: quick-adjust —
  быстрый luma/neutral nudge поверх профиля, снятого полной 6-гранной регистрацией. Не притворяемся,
  что он проверяет разделимость.
- **[HIGH#3] Фиксируем БЕЛУЮ грань (U).** «Покажи белую грань» — near-neutral, робастный argmin, корректный
  патч для white-balance. «Любая грань» запрещена (циркулярность: система классифицировала бы её кривым
  профилем). Reject если медиана 9 стикеров не уверенно белая → полная перекалибровка.
- **[HIGH#4] Quick-adjust НЕ разблокирует соревновательный таймер.** Флаг `validated` в сессии: seeded+
  quick-adjusted профиль = `validated:false`. Соло сейчас casual → quick-adjust кормит соло-таймер, но
  solve помечается non-validated (Этап 4 ranked это учтёт: ranked требует accuracy-гейт / полное чтение).

## Acceptance criteria
1. Выбран кубик с `color_profile` → refs сидятся из профиля; ритуал открывается экраном **CALIBRATE_SOLVED**
   (просит ОДНУ белую грань), ДО walkthrough скрамбла.
2. Нет профиля (аноним / нет кубиков) → фолбэк на существующую полную 6-гранную калибровку, без изменений.
3. Quick-adjust читает белую грань, вычисляет von-Kries gain, применяет ко всем 6 refs (session-local).
4. Гейт «сошлось» на наблюдаемых: 9 стикеров тесно кластеризованы И уверенно белые (min-ΔE ≪ 2nd-best);
   иначе → маршрут на полную 6-гранную перекалибровку.
5. Показанная грань не бьётся уверенно с белым (> `QUICK_ADJUST_MATCH_DE`) → «похоже, другой кубик /
   не белая грань — выбрать профиль / перекалибровать».
6. FSM порядок: `CALIBRATE_SOLVED → SCRAMBLE_SHOWN → SCRAMBLE_VERIFY → READY → SOLVING → STOPPED →
   SOLVE_VERIFY → result`; таймер не может взвестись до показа собранного кубика И verify скрамбла.
7. `again` → возвращает в CALIBRATE_SOLVED и **очищает/пере-сидит refs** (второе соло не пропускает
   honest-start со stale refs).
8. Профиль после quick-adjust помечен `validated:false`; НЕ пишется в `color_profile` (session-local).
9. Accuracy-режим (Этап 0.3) продолжает мерить СВЕЖУЮ полную калибровку — НЕ сидит из профиля.
10. Все существующие тесты (colors/soloPhase/cubesStore/accuracyRun) зелёные + новые тесты.

## Plan (merged: planner + skeptic HIGH/MED/LOW)

### Vision-математика (самый риск)
- **`frontend/src/vision/colors.ts`** — NEW чистые fns:
  - `quickAdjust(refs, observedRgb): {refs, matchedColor, matchedDE, secondBestDE, converged}` —
    **[HIGH#1]** von-Kries per-channel gain в linear-sRGB по белому (lab→rgb→linear→×gain→srgb→lab),
    применить ко всем 6; **[HIGH#3]** matchedColor = argmin ΔE, требовать matchedColor==="U" (белый);
    `converged` считается на **наблюдаемой** грани (см. reader), не на сдвинутых refs.
  - `observedFaceStats(grid9): {clusterSpread, nearestColor, nearestDE, secondBestDE}` — **[HIGH#1/MED]**
    статистика наблюдаемой грани для гейта (внутрикластерный разброс + уверенность матча). Использует
    `config.DELTA_E_MODE`.
  - `minPairwiseRefDE(refs)` — оставить как санити стора (но НЕ как гейт «сошлось»).
- **`frontend/src/vision/config.ts`** — **[MED]** новые пороги (distinct, не оверлоадить MIN_RED_ORANGE_DE):
  `QUICK_ADJUST_MATCH_DE` (~25, макс ΔE белой грани до white ref), `QUICK_ADJUST_CLUSTER_DE` (макс
  внутрикластерный разброс 9 стикеров), `QUICK_ADJUST_MARGIN_DE` (min зазор nearest vs second-best).

### Reader
- **`frontend/src/vision/hooks/useCubeReader.ts`** — **[MED seeding]**:
  - `seedProfile(profile: Refs): void` — `refsRef.current = clone`, `calibrated=true`, `seeded=true`, `validated=false`.
  - `quickAdjust(video): QuickAdjustResult` = `{kind:"ok"} | {kind:"wrong-face"; de} | {kind:"diverged"; ...} | {kind:"unreadable"}`.
    readable-гейт → readFace белой грани → `observedFaceStats` → если nearest≠white ИЛИ margin/cluster плохие
    → wrong-face/diverged (refs НЕ трогаем, caller → полная перекалибровка); иначе `colors.quickAdjust`
    (session-local) → ok. Expose `seeded`, `validated`.
  - **[LOW]** quick-adjust строго in-memory; НЕ вызывает cubes API / PATCH color_profile.
- **`frontend/src/vision/hooks/useCamera.ts`** — **[LOW]** зафиксировать exposure/WB через track constraints
  (`applyConstraints` exposureMode/whiteBalanceMode:"manual" где поддерживается; best-effort, не падать).

### Профиль ↔ refs + стор
- **`frontend/src/api/cubes.ts`** — `profileToRefs(p)` / `refsToProfile(r)` (структурно одинаково, U/R/F/D/L/B ↔ [L,a,b]).
- **`frontend/src/store/cubesStore.ts`** — `getSelectedProfile(): ColorProfile | null` (как `getSelectedCubeId`:
  профиль только для кубика реально в списке).

### FSM (Part C)
- **`frontend/src/solo/soloPhase.ts`** — **[MED]** перестроить порядок: фазы `loading → calibrate
  (CALIBRATE_SOLVED, NEW первый экран) → walkthrough → verify → armed → solving → stopped (NEW) →
  solve_verify (NEW) → result`. Действия: `calibrate_ok`, `solve_verify_ok`, `solve_verify_mismatch`.
  `scramble_ready`: loading→calibrate. `calibrate_ok`: calibrate→walkthrough (единственный путь дальше →
  таймер не взведётся без показа собранного). `solve_stop`: solving→stopped (запись stopT/elapsedMs), НЕ
  сразу result. `solve_verify_ok`: stopped→result. **[MED]** `again` → **calibrate** (не loading). Сохранить
  timer-arm гейт (solve_start только armed+scrambleVerified) + StrictMode-safe single-fire save.
- **`frontend/tests/solo/soloPhase.test.ts`** — обновить: новый порядок, calibrate-first, solve_stop→stopped→
  solve_verify_ok→result, timer-arm гейт держится, abort DNF, again→calibrate.

### Оркестратор + UI
- **`frontend/src/solo/useSoloSession.ts`** — на входе в ритуал: `getSelectedProfile()!=null` →
  `reader.seedProfile(profileToRefs(...))` + фаза calibrate ведёт `quickAdjustStep()` (одна белая грань →
  `calibrate_ok` на ok; diverged/wrong-face → полная 6-гранная перекалибровка; сообщение pick-other-cube).
  Нет профиля → фаза calibrate гонит существующий 6-гранный `captureCalibration` → `calibrate_ok` когда
  `reader.calibrated`. **[MED]** STOPPED→SOLVE_VERIFY: собрать собранный кубик (эталон = **SOLVED** facelets,
  НЕ скрамбл-таргет) → `solve_verify_ok` → result. Save-эффект пере-ключить на терминал result. **[HIGH#4]**
  прокинуть `validated` в сохраняемый solve (пока соло casual — пишем, но помечаем).
- **`frontend/src/solo/SoloPage.tsx`** — экран `CalibratePanel` (фаза calibrate): профиль → «Покажи белую
  грань собранного [name]» + кнопка quick-adjust + фолбэк «Перекалибровать (6 граней)» + «другой кубик»
  на wrong-face; без профиля → существующий 6-гранный UI. Walkthrough только после calibrate. `SolveVerifyPanel`
  (фаза solve_verify): показать собранный → подтвердить → ResultScreen. CameraStage покрывает calibrate/stopped/solve_verify.

### Регрессия (skeptic LOW)
- **`frontend/src/accuracy/useAccuracySession.ts`** — **[LOW]** accuracy-режим НИКОГДА не сидит из профиля;
  форсит полную калибровку (уже так — добавить явный барьер/коммент, тест что seedProfile там не вызывается).

## Tests
- colors: `quickAdjust` von-Kries gain по белому применяется ко всем 6; **регрессия** — аддитивный Lab-сдвиг
  оставляет `minPairwiseRefDE` неизменным (доказывает, почему нужен мультипликативный + гейт на наблюдаемых);
  `observedFaceStats` ловит рыхлый кластер / слабый margin.
- colors/accuracy: профиль под светом A, синтетический gain света B на смешанный кубик → `classifyFace`/квоты
  точность ≥ `ACCURACY_PASS_FRAC` (проверяет, что von-Kries-коррекция не хуже полной калибровки под B для
  ГЛОБАЛЬНОГО сдвига; **честно фиксируем в тесте, что цвет-селективный сдвиг она не чинит**).
- useCubeReader: `seedProfile` → calibrated+seeded+validated=false; `quickAdjust` wrong-face когда грань не
  белая (>MATCH_DE); diverged оставляет seeded refs.
- soloPhase: новый порядок (см. выше).
- cubesStore: `getSelectedProfile` null для stale/absent, профиль для present.
- Manual QA (камера): профиль → одна белая грань ~3с → honest start; diverged → 6-гранный промпт; не тот
  кубик/грань → pick-other. + accuracy-режим по-прежнему меряет полную калибровку.

## Blockers
Нет — риск-решение принято: quick-adjust = casual-solo, `validated:false`, ranked (Этап 4) за accuracy-гейтом.

## Out of scope
- Backend (cubes/CRUD/миграции — 2.4, схема не меняется). Флаг `validated` — session/solve-level, без схемы БД сейчас.
- Мастер регистрации / «Мои кубики» / онбординг (готово в 2.4).
- Дуэль/мультиплеер ритуал (только соло). Ranked-гейт (accuracy перед соревновательным) — Этап 4.
- Пер-кубик статы, лидерборд «каким кубиком», auto cube-contour (roadmap).
- Многогранная (2-3) подстройка — отклонена в пользу честного 1-грань-casual + accuracy для ranked.

## Assumptions
- `ColorProfile` ключи U/R/F/D/L/B == позиционные грани ридера (COLOR_NAMES); U=white (FACE_LABELS_RU/guide).
- Quick-adjust = ОДНА белая грань (casual ~3с путь); полный 6-гранный = fallback перекалибровки.
- «Сошлось» = гейт на наблюдаемой белой грани (кластер+margin), + `minPairwiseRefDE` как отдельная санити стора.
- SOLVE_VERIFY (honest finish) — в скоупе (эталон SOLVED, не скрамбл). Соло сейчас casual → таймер от quick-adjust ок, помечен non-validated.
- von-Kries коррекция не чинит цвет-селективный сдвиг (R/O) — принято и явно задокументировано; ranked требует полной валидации.
