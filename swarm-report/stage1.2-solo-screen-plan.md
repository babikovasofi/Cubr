# Plan: Этап 1.2 — соло-экран сборки   (slug: stage1.2-solo-screen)

## TL;DR
Полный ритуал §5.1 (без соперника) на `/solo` в `frontend/`: доводим 4 хук-заготовки
(`useCamera`, `useHands`, `useTwisty`, `useScramble`) до рабочих и **StrictMode-safe**,
собираем per-frame петлю `camera → hands.detect → HandsFsm.step → timer`, генерим cubing-скрамбл,
показываем визуальный walkthrough (анимация хода `<twisty-player>` + русский текст направления
+ мини-карта + переключатель нотация/визуал), проверяем сборку камерой (6 граней vs эталон),
таймер по рукам, экран результата с «ещё раз». Опора — уже перенесённые чистые модули
(`fsm`, `colors`, `cubeState`, `cubeGrid`, `guide`, `moveCopy`, `walkthrough`) с тестами.
Точная проводка берётся из `prototype/main.ts` + `prototype2/main.ts`.

## Acceptance criteria (observable; /review проверяет эти)
1. `/solo`: камера стартует, поверх зеркального видео рисуются landmarks + зоны + рамка-гид;
   отказ/отсутствие/занятость камеры → правильное русское сообщение (NotAllowedError /
   NotFoundError / insecure-context различаются), без краша.
2. Генерится cubing-скрамбл; `ScrambleWalkthrough` показывает состояние кубика после каждого
   хода через `<twisty-player>` с **анимацией текущего хода**, русский текст направления
   (`moveCopy`), прогресс «{n} из {M}», кнопки назад/дальше, мини-карта, стрелки/пробел с
   клавиатуры; баннер ориентации «белый верх, зелёный к себе».
3. Переключатель нотация/визуал переключает walkthrough ↔ строка скрамбла; выбор персистится
   в localStorage (`cubr.scramble.showNotation`) между перезагрузками.
4. «Готово, проверить» собирает 6 граней; несовпадение → показывает какая грань + путь
   «вернуться к инструкции»; совпадение → **взводит** таймер.
5. **Таймер только на верифицированном скрамбле**: FSM не проходит дальше `HANDS_IN_ZONE`
   пока не выставлен `scrambleVerified`. Обе руки в зонах → неподвижность → убрал руки =
   старт; руки назад = стоп; abort (потеря детекции) = reset.
6. **Elapsed из timestamp кадров, не из React-тика**: время = `stop_t − start_t`, где `o.t`
   кадров, породивших `solve_start`/`solve_stop` (никакого `performance.now()` в React-хендлере).
7. Экран результата: фиксированное время + «ещё раз» → новый скрамбл + рестарт цикла без
   перезагрузки страницы (вызывает `fsm.reset()`).
8. **StrictMode двойной mount** не оставляет утёкший `getUserMedia`-стрим, дубль `<twisty-player>`,
   дубль `HandLandmarker`/rVFC-петли; unmount останавливает камеру + `landmarker.close()`.
9. `npm run test`, `npm run typecheck`, `npm run lint` — зелёные; ни один файл > 400 строк.

## Plan (merged: planner + skeptic HIGH/MED)

### Хуки (заготовки → рабочие)
- **`frontend/src/vision/hooks/useCamera.ts`** — порт `prototype/camera.ts`: Camera-класс
  (getUserMedia ideal 60fps/1280×720, muted playsInline video, DOMHighResTimeStamp-clock,
  stop() убивает tracks+loop). **[skeptic HIGH]** эффект с `cancelled`-флагом: `start().then(s=>{
  if(cancelled){ s.getTracks().forEach(t=>t.stop()); return } … })`; cleanup ставит cancelled=true
  И стопит уже полученное. НЕ полагаться на module-level guard. **[skeptic HIGH rVFC]** хранить
  id rVFC, cleanup `cancelVideoFrameCallback(id)` + флаг `running` который колбэк проверяет перед
  ре-регистрацией и перед `detect`; bail если `readyState<2`; feature-detect rVFC → fallback rAF+
  `currentTime`-delta (Firefox). **[skeptic LOW]** try/catch getUserMedia → различать
  NotAllowedError/NotFoundError/insecure; frameRate только `ideal`.
- **`frontend/src/vision/hooks/useHands.ts`** — порт `prototype/hands.ts` (FilesetResolver +
  HandLandmarker с pinned 0.10.35 CDN wasm/model, detect→HandObservation, зоны, HandsInitError).
  **[skeptic MED]** явно `numHands:2` + `runningMode:"VIDEO"` при создании (дефолт 1 → FSM
  никогда не увидит «обе»). Preload с спиннером, ошибки через HandsInitError. cleanup `.close()`.
- **`frontend/src/vision/overlay.ts`** — NEW (сплит из useHands < 400 строк): `drawOverlay` +
  `defaultZones` из `prototype/hands.ts`.
- **`frontend/src/scramble/hooks/useTwisty.ts`** — ref-mount одного TwistyPlayer в useEffect
  (opts из `prototype2/twisty.ts`), cleanup чистит slot + дропает player, StrictMode-guarded.
  API: `showState(moves,n)` (static setup-alg) + `animateMove(moves,n)` + ready-флаг.
- **`frontend/src/scramble/hooks/useScramble.ts`** — обёртка: генерит один скрамбл на mount
  (cancel-флаг), `{scramble, moves, loading, error, regenerate}`, `parseMoves`. **[skeptic MED]**
  явный loading/error UI с retry (cubing грузится ESM с CDN — offline/CSP ломает). Мост к
  `cubeState.scrambleToFacelets` для эталона верификации.

### Solo (новое)
- **`frontend/src/solo/soloPhase.ts`** — NEW чистый reducer фаз (scramble → walkthrough →
  verify → armed → solving → stopped → result) + verify-mismatch/abort + гейт таймера. **[skeptic
  HIGH]** несёт `start_t`/`stop_t` из `o.t` кадров. DOM-free, юнит-тест.
- **`frontend/src/solo/useSoloSession.ts`** — NEW оркестратор: per-frame петля (camera onFrame →
  hands.detect → fsm.step → timer), verify-сбор 6 граней (`useCubeReader` + `cubeGrid`/`cubeState`),
  фаза, дебаунс-снапшот гида. Порт из `prototype/main.ts`.
- **`frontend/src/solo/ScrambleWalkthrough.tsx`** — NEW: twisty-слот + анимация хода + русский
  текст (`moveCopy`) + прогресс-бар + назад/дальше + мини-карта + клавиатура (стрелки/пробел,
  игнор при фокусе на контроле) + баннер ориентации + переключатель нотация/визуал (localStorage).
  Порт рендера `prototype2/main.ts` поверх чистого `walkthrough.ts`.
  **Стрелка = анимация хода** (spec §4.1 утв.); отдельный SVG-оверлей — вне скоупа 1.2.
- **`frontend/src/solo/CameraStage.tsx`** — NEW: CSS-зеркальное `<video>` + оверлей `<canvas>` +
  скрытый work `<canvas>`, размер по intrinsic видео; русские ошибки камеры.
  **[skeptic MED mirror]** одна конвенция: зеркалим ТОЛЬКО CSS-transform на `<video>`, вся
  выборка (`readFace`/MediaPipe) + геометрия оверлея — в raw-координатах, оверлей-контейнер
  флипается тем же transform. Тест: рука справа физически → нужная зона.
- **`frontend/src/solo/ResultScreen.tsx`** — NEW: переиспользует `Timer` (success/dnf) для
  фиксированного времени; «ещё раз» → regenerate + reset цикла (**обязательно `fsm.reset()`**,
  skeptic LOW); DNF-копия на abort.
- **`frontend/src/pages/SoloPage.tsx`** — заменить заглушку: компоновка useSoloSession +
  CameraStage + ScrambleWalkthrough + verify-контролы + ResultScreen за soloPhase; ссылка домой.
- **`frontend/src/vision/hooks/useCubeReader.ts`** — добавить work-canvas ref + collect-6 helper
  (verify без перезагрузки). Минимальный inline quick-calibrate (порт `main.ts btnCalibrate`) —
  verify нужны 6 эталонов, standalone.

### Tests
- `frontend/tests/solo/soloPhase.test.ts` — NEW: все переходы reducer вкл. verify-mismatch
  (таймер остаётся невзведён), abort reset, stop→result, start_t/stop_t.
- `frontend/tests/scramble/scrambleParse.test.ts` — NEW: `parseMoves` + мост cubing-строка →
  `cubeState.scrambleToFacelets` → `validateFacelets`-легальное 54-символьное состояние.
- Опираемся на существующие ported-тесты (fsm, colors, cubestate, guide, moveCopy, walkthrough) —
  не дублируем.
- **Manual QA** (документируется, не автоматизируется, testing-conventions): реальная камера +
  кубик на `/solo` по §5.1; StrictMode mount/unmount ×2 → один стрим/player/landmarker.

## Blockers
Нет. Единственный кандидат (как рисуем «стрелку») снят спекой §4.1: анимация хода `<twisty-player>` —
утверждённый способ, SVG-оверлей — fallback вне скоупа 1.2.

## Out of scope
- Соперник, matchmaking, WebSockets, синхронный отсчёт, кубки (§4, §5.2 Ao5, §5.3 rematch, §5.4).
- Серверная валидация скрамбла/кадров + анти-чит (Этап 3).
- Аккаунты/онбординг/персист профиля; экран настроек цвет-калибровки (Этап 2, §8) —
  `scramble_display` пока localStorage.
- Непрерывный per-move камера-трекинг скрамбла (feature-scramble-visual §5 — V2/V3).
- Мобилка / мобильная заглушка (Этап 6).
- SVG-стрелка-оверлей сверх twisty-анимации.

## Assumptions
- Solo = §5.1 минус соперник: без сервера, без отсчёта-синка; таймер+скрамбл целиком клиентские
  (workplan 1.2 «временно, до бэкенда»).
- «Стрелки» = twisty-анимация + русский текст направления (spec §4.1, утв.; prototype2 выбрал анимацию).
- Калибровка цвета НЕ переезжает на `/solo` как отдельный экран (Settings §8, Этап 2); для verify —
  минимальный inline quick-calibrate (6 граней), порт из `main.ts`.
- React 19 монтирует `<twisty-player>` императивно через ref, не JSX.
- Экран результата — упрощённый соло-вариант §5.3 (своё время + «ещё раз»), без победителя/кубков/rematch.
- cubing pinned-версия (не moving `v0`); CSP-заметка: connect-src/worker-src/script-src должны пускать
  cdn.cubing.net + cdn.jsdelivr.net + storage.googleapis.com.
