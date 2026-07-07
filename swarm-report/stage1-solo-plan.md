# Plan: Этап 1.2 — соло-экран сборки   (slug: stage1-solo)

> planner + skeptic (оркестратор вручную). Skeptic verdict = **revise** (5 HIGH) —
> главное: **резать на слайсы** + точные React-паттерны. Ветка `stage-1-solo`.

## TL;DR
Рабочий `/solo`: полный ритуал userflow §5.1 БЕЗ соперника на реальной камере.
Довести хук-заготовки 1.1 до рабочих (порт `prototype/` + `prototype2/` DOM/эффект-логики
в React-хуки/компоненты) и собрать флоу. **Чистые модули (fsm, guide, colors, cubeGrid,
cubeState, accuracy, walkthrough, moveCopy) переиспользуются как есть — не переписывать.**

## Верификация = ручная (важно)
Реальная камера headless НЕ гоняется → **вся приёмка 1.2 — ручная браузерная QA** с живой
камерой + физическим кубиком (делает пользователь). Оркестратор в браузере может проверить
только load-time, StrictMode (нет двойной камеры), рендер оверлея — не сам ритуал.

## Slicing (skeptic HIGH4 — обязательно; не начинать следующий, пока предыдущий не зелёный in-app)
- **Slice A (СНАЧАЛА — рискованное ядро):** камера + hands + FSM + таймер в React.
  useCamera (порт camera.ts), useHands (порт hands.ts + MediaPipe), CameraStage-компонент,
  onFrame → `hands.detect` → чистый `fsm.step` → single-clock таймер (DOM-ref) → drawOverlay.
  Без чтения кубика/калибровки/скрамбла/twisty. **Успех:** arm→solve_start→solve_stop→заморозка
  таймера работает в реальном app, ровно ОДНА камера при StrictMode-двойном-маунте, чистый
  release при уходе с /solo.
- **Slice B:** work-canvas + калибровка 6 граней + чтение/verify/confirm (readFace/cubeGrid/
  cubeState/accuracy). Гейт таймера на `scrambleVerified`.
- **Slice C:** генерация скрамбла (cubing CDN) + `<twisty-player>` walkthrough (useTwisty,
  walkthrough.ts, moveCopy, нотация-тумблер, клавиатура, мини-карта). Verify-before-timer.
- **Slice D:** экран результата + полная RU-guide-проекция + сборка фазовой машины end-to-end.

**Этот план — весь 1.2; ближайший /build = Slice A.** B/C/D — отдельными build'ами.

## Архитектура (skeptic HIGH1/2/3/5 — сердце фичи)
1. **StrictMode-safe (HIGH1):** StrictMode включён (`main.tsx`). НЕ гардить только булевым
   ref-флагом (глотает второй реальный маунт после route in/out → мёртвая камера). Паттерн
   **async-cancellation**: эффект `let cancelled=false`; после каждого await проверять; cleanup
   ставит `cancelled=true` И тушит захваченное (`stream.getTracks().forEach(t=>t.stop())`,
   `landmarker.close()`, `slot.replaceChildren()`). getUserMedia async → если стрим зарезолвился
   ПОСЛЕ своего cleanup, сразу стопнуть его треки.
2. **Hot-loop в refs, публикация на переходах (HIGH2):** onFrame (rVFC) читает/пишет ТОЛЬКО
   refs (единый `sessionRef` — зеркало module-стейта прототипа), НИКОГДА React-стейт/prop-замыкание.
   Один стабильный `onFrame` (`useCallback` пустые deps, читает `ref.current`). Публиковать в
   React-стейт только когда меняется видимое UI: FSM-переход, lastError, scrambleVerified,
   collector.count — это `lastGuideKey`-гейт прототипа как `setState` (не 60×/с).
3. **Таймер НЕ per-frame setState (HIGH3):** `solveStartTs` в ref; в rVFC писать elapsed прямо
   в DOM-node таймера по ref (`node.textContent = fmt(nowTs-start)`) — как прототип. React владеет
   только start/stop-переходами и финальным замороженным временем. **Один clock** — `nowTs` из
   rVFC (performance.now-домен), никогда Date.now()/свежий performance.now() (иначе таймер и
   fsm-debounce разъезжаются).
4. **Камера один раз (HIGH5):** захват в ОДНОМ mount-эффекте /solo, держать через все фазы,
   release только на unmount/route-away. Фазы НЕ трогают lifecycle камеры — только читают кадры.
   Клик «Включить камеру» — только жест-триггер разрешения, привязан к «захватить один раз».
   Проверка: уйти на Home → лампочка камеры гаснет.
5. **Event-стейт через useReducer (MED):** collector, calibrationStep, refs, calibrationRefsRgb,
   scrambleVerified, lastError, gateMode — событийные (не 60fps) → React-стейт/**useReducer**
   (resetCycle/beginCollection прототипа уже reducer-образны). Loop читает ref-ЗЕРКАЛО тех
   немногих, что ему нужны (scrambleVerified), обновляемое в том же setState.
6. **guide из ref-истины (MED):** `GuideSnapshot` строить из ТЕХ ЖЕ refs, что мутит loop, в
   момент публикации (на lastGuideKey-переходе), не из React-lagged стейта. `guide.ts` не трогать.
   Не класть живой `solveElapsedMs` в snapshot каждый кадр (только на SOLVING/STOPPED).

## Acceptance — Slice A (ручная браузерная QA)
1. `/solo`: онбординг-панель (RU: нужен кубик 3x3 + камера) + «Включить камеру».
2. Клик → getUserMedia prompt; allow → живое видео (зеркальное) + оверлей (жёлтая рамка-гид +
   2 зелёные зоны рук + landmarks при наличии рук).
3. Камера denied → `cameraDeniedRu()`; model-download-failed (заблокить CDN) → `modelFailedRu()`;
   оба recoverable (retry без перезагрузки).
4. Руки в зоны + неподвижно → FSM READY; убрал руку → таймер СТАРТ (timer-lg, бегущая точка);
   обе руки назад → таймер СТОП, время заморожено. (Тайминг = прототип, single clock.)
5. **Ровно одна камера** при StrictMode-двойном-маунте; уход с /solo → треки остановлены
   (лампочка гаснет). Полный arm→solve→stop дважды подряд без перезагрузки.
6. `npm test`/`tsc`/lint зелёные (юнит — только на НОВОЙ чистой логике, если появится).

## Affected files — Slice A
- `frontend/src/vision/hooks/useCamera.ts` — реализовать (порт `prototype/camera.ts`): getUserMedia
  60fps, videoRef, rVFC-loop (fallback rAF) с `nowTs`=DOMHighResTimeStamp, stop() тушит треки+srcObject.
  Re-export CameraError. Async-cancellation внутри.
- `frontend/src/vision/hooks/useHands.ts` — реализовать (порт `prototype/hands.ts`): FilesetResolver+
  HandLandmarker (CDN wasm/model пин 0.10.35), detect→HandObservation (bothInZone, масштабо-инвариантная
  неподвижность по handednessRaw, handsOutOfZone), defaultZones, flipHandedness, drawOverlay. HandsInitError.
  init() идемпотентен.
- `frontend/src/vision/components/CameraStage.tsx` — НОВЫЙ: `<video>` (CSS scaleX(-1)) + оверлей-canvas
  + скрытый work-canvas (для B), §6.1 (16:9, radius 10, REC-чип, зоны/рамка через drawOverlay).
  Нейтральные токены у камеры.
- `frontend/src/pages/SoloPage.tsx` — заменить заглушку на оркестратор Slice A: refs (video, overlay),
  `sessionRef`, единый useEffect (камера+hands, async-cancellation), стабильный onFrame (detect→fsm.step→
  DOM-ref таймер→drawOverlay), публикация FSM-стейта на переходе. Онбординг + «Включить камеру» жест.
- `frontend/src/components/Timer.tsx` — расширить: `ref`-доступ к DOM-node для per-frame записи; live
  `value` + phase→точка; timer-lg при беге, timer-md idle.
- (тесты) — только если появится новая чистая утиль (напр. форматтер времени) → Vitest.

## Blockers
Нет открытых. Нарезка решает scope-HIGH. **Ближайший build = Slice A**; B/C/D после того как A
зелёный в реальном app. Внутренний гейт: если StrictMode-двойная камера / stale-closure не решаются
чисто — стоп, разобрать, не пропихивать.

## Tests
Ритуал/камера/hands/twisty = ручная браузерная QA (headless не может камеру). Vitest — ТОЛЬКО новая
чистая логика (форматтер времени, phase→sub-screen селектор). НЕ ре-тестить fsm/walkthrough/colors/
cubeGrid/cubeState/accuracy/moveCopy/guide — переиспользуются со своими сьютами. `npm test`+`tsc`+lint зелёные.

## Out of scope
Бэкенд/аккаунты/серверный скрамбл/событийная валидация/кадры-доказательства (Этапы 2–3); дуэли/
матчмейкинг/WS/статус соперника/синхронный отсчёт/реванш (Этап 4); турнир недели (Этап 5); **Ao5**
(мульти-сборка — отложено, соло = одна сборка); Stage-0 accuracy-гейт (QA-инструмент, не продуктовый
ритуал — модули остаются, на /solo не выводить); полные анимации таймера §7 (статик+live хватает);
персист калибровки в профиль/Settings §8 (Этап 2); мобилки §10; непрерывный CV-трекинг ходов (V2/V3).

## Assumptions
- Соло = без соперника: без серверного отсчёта 3-2-1 и UI статуса соперника; таймер армится, как
  руки READY после verify (поведение прототипа). Без сервера/WS.
- Скрамбл на клиенте (cubing `randomScrambleForEvent('333')`, workplan «временно, до бэкенда»).
- Продуктовый путь = нотация/визуальный скрамбл (guide scrambleSet/scrambleVerified); accuracy-гейт
  прототипа (gateMode/btn-accuracy) НЕ часть соло-ритуала.
- Онбординг = лёгкая in-page панель (3 RU-пункта + камера-чек), не мульти-экран §1 (тот — Этап 2).
- Одна сборка (Fast-стиль), Ao5 отложен. Verify только в конце скрамбла (не per-move CV).
- `parseMoves` в frontend нет (был в prototype2) → сплит строки скрамбла в компоненте
  (`scramble.split(/\s+/).filter(Boolean)`); крошечная util при нужде теста.
- Новые компоненты (CameraStage/CalibrationPanel/ScrambleWalkthrough/ResultCard) — по design-system §5/§6.
