# Plan: Этап 0.3 — режим замера точности зрения (accuracy-gate)   (slug: stage0.3-accuracy-gate)

## TL;DR
Dev-only экран `/accuracy` в `frontend/`, честно измеряющий per-sticker точность классификатора цвета
на реальном кубике/свете и решающий гейт R1 (**≥90%**). Ключевое (по skeptic): мерим **сырое**
per-sticker чтение (не легально-разрешённое — иначе survivorship bias), при **фиксированном порядке/
ориентации** захвата граней (независимое выравнивание, без циркулярности), с **разбивкой по условиям**
(свет/кубик/человек) и гейтом **min-over-conditions Wilson-LB ≥90%** (не pooled mean), считая
**dropped/illegal** чтения в знаменателе. Переиспользует `accuracy.ts` (`scoreRead`/`formatReport`),
добавляет accumulator + raw-read exposure. Второй deliverable — письменный протокол ручного QA.

## Acceptance criteria (observable; /review проверяет)
1. Роут `/accuracy` есть **только в dev** (`import.meta.env.DEV`, lazy-import, tree-shake из прод-бандла;
   нет прод-нав-ссылки). Композит: CameraStage + панель.
2. `accuracy.ts` импортится и используется **без правок** (`scoreRead`/`formatReport`/`isFace`).
3. **Фиксированный захват:** тестер показывает 6 граней в заданном порядке/ориентации (U,R,F,D,L,B при
   «белый верх, зелёный к себе»); выравнивание к URFDLB **не выводится из чтения** — известно априори.
4. **Сырое чтение:** `useCubeReader` отдаёт сырые per-sticker argmin-грани (до legality-resolve); harness
   собирает 54-символьный raw-read по фикс-порядку и скорит `scoreRead(rawRead, groundTruth)`.
5. **Ground truth независим:** режим «известный скрамбл» → `cubeState.scrambleToFacelets` (тестит red/orange,
   white/yellow адъяцентности); режим «собранный» → SOLVED (санити). Оба — не производны от чтения.
6. **Аккумулятор по условиям:** каждое чтение тегается `{light,cube,person,calib}`; merge confusion + per-index
   correct/total на условие; хранится N_scored и **N_dropped** (+ гистограмма причин resolve/illegal/ambiguous).
7. **Гейт:** PASS ⟺ по КАЖДОМУ условию Wilson-нижняя-граница доли ≥ `ACCURACY_PASS_FRAC` (0.90) **И** drop-rate
   условия ниже порога. Экран показывает per-condition таблицу, min-условие, PASS/FAIL badge, red↔orange /
   white↔yellow confusion с их N. Требование значимости: **≥20 чтений/условие** до вердикта.
8. **Дрейф калибровки:** enforce `config.CENTER_DRIFT_DE` на каждой захваченной грани — при дрейфе reprompt/
   исключить (иначе меряем калибровку, не зрение); провенанс калибровки пишется в тег.
9. Нечитаемое/illegal/ambiguous → русская ошибка + учёт в N_dropped, **не** скорится (не портит аккумулятор).
10. Отчёт copy-export (`formatReport` + сводка аккумулятора) для вставки в протокол.
11. `docs/qa/stage-0.3-vision-accuracy.md` — протокол (матрица условий, N/условие, правило гейта,
    ритуал калибровки, исключения); слинкован из `.memory-bank/tasks/README.md`.
12. tsc чисто; новые unit-тесты зелёные (accumulator + assembler + accuracy.ts).

## Plan (merged: planner skeleton + skeptic HIGH/MED/LOW)

### Vision-ядро
- **`frontend/src/vision/hooks/useCubeReader.ts`** — **[skeptic HIGH#1]** расширить accuracy-collector: на
  6-й грани вернуть `{rawFaceGrids: Face[][], resolved: Facelet|null, dropReason?}` — **сырые** per-sticker
  argmin-грани (до/помимо resolveRotations). Общий 6-гранный resolve вынести в приватный helper (verify не
  ломать). **[skeptic MED]** enforce `CENTER_DRIFT_DE` per-face (сейчас только luma `readable()`).
  Фикс-порядок: грани принимаются в заданной последовательности (U,R,F,D,L,B), assignFacesByCenter НЕ нужен
  для выравнивания (порядок известен) — центр служит лишь санити/дрейф-чеком.
- **`frontend/src/vision/accuracyRun.ts`** — NEW чистый (DOM-free, node-тест). **[skeptic HIGH#1/#3]**:
  - `assembleRawRead(rawFaceGrids по фикс-порядку)` → 54-символьный URFDLB raw-read (без rotation-recovery,
    порядок/ориентация фиксированы протоколом).
  - `ConditionKey = {light,cube,person,calib}`; `AccuracyRun` = Map<condKey, {confusion, correct, total,
    nScored, nDropped, dropReasons}>.
  - `appendRead(run, condKey, report)` merge confusion + counts; `appendDrop(run, condKey, reason)`.
  - **[skeptic HIGH#3/MED]** `conditionVerdict(cond)` = Wilson-LB(correct,total, z=1.96) ≥ passFrac **И**
    nScored≥MIN_READS(20) **И** dropRate≤MAX_DROP; `gatePass(run)` = min-over-conditions; hotspot-counters
    red↔orange / white↔yellow с N.
  - `formatRunSummary(run)` — многострочная сводка (условия, min, PASS/FAIL, drop, hotspots).
- **`frontend/src/vision/accuracy.ts`** — **НЕ править** (по брифу). **[skeptic LOW]** покрыть тестами (ниже).

### Экран (dev-only)
- **`frontend/src/accuracy/useAccuracySession.ts`** — NEW оркестратор (паттерн useSoloSession минус hands/FSM/
  timer/save): videoRef/overlay/work, `useCamera(onFrame=draw guide overlay)`, `useCubeReader` accuracy-collector,
  `useScramble` (known-scramble ground truth). State: mode (`solved|scramble`), калибровка passthrough,
  фикс-порядок захвата (шаг 1/6..6/6), текущий condition-тег (форма ввода), `AccuracyRun` в useState. На «read» →
  `assembleRawRead` → `scoreRead(raw, truth)` → `appendRead`; на drop → `appendDrop`.
- **`frontend/src/accuracy/AccuracyControls.tsx`** — NEW: mode-toggle, форма condition-тега (свет/кубик/человек),
  калибровка-субпанель, «Снять грань n/6» (в фикс-порядке с подсказкой ориентации), текущий отчёт, per-condition
  таблица + min-условие + PASS/FAIL badge (зел ≥90 Wilson / красн), drop-счётчик, hotspots, copy-report, reset/recalib.
- **`frontend/src/accuracy/AccuracyPage.tsx`** — NEW: CameraStage (as-is) + AccuracyControls; в scramble-режиме
  показать `ScrambleWalkthrough`/moves. Заголовок «Замер точности зрения (гейт 0.3)», back-home.
- **`frontend/src/App.tsx`** — **[skeptic LOW#7]** `/accuracy` роут только `import.meta.env.DEV` + `React.lazy`
  (tree-shake из прода). Прод-нав-ссылки нет.
- **`frontend/src/pages/HomePage.tsx`** — dev-only entry-link на `/accuracy` (под `import.meta.env.DEV`).

### Tests
- **`frontend/tests/vision/accuracyRun.test.ts`** — NEW: `assembleRawRead` (синтетическое идеальное чтение в
  фикс-порядке → ровно `scrambleToFacelets`, 54/54); инъекция K ошибок → `scoreRead` ровно K неверных + верные
  confusion-ячейки; merge по условиям суммирует; **Wilson-LB** гейт на границе 0.90; min-over-conditions
  (одно проваленное условие → gate FAIL); drop учитывается в вердикте; MIN_READS-порог.
- **`frontend/tests/vision/accuracy.test.ts`** — NEW **[skeptic LOW]**: `scoreRead` считает верно/confusion;
  `isFace` не роняет mismatched; FACE_ORDER↔COLOR_NAMES идентичность.
- **Manual (сам гейт, по протоколу):** 3 света × ≥2 кубика × 1–2 человека, ≥20 чтений/условие, min-over-conditions
  Wilson-LB ≥90%. Не автоматизируется headless — это и есть доказательство deliverable, гоняет человек.

### Docs
- **`docs/qa/stage-0.3-vision-accuracy.md`** — NEW протокол: ритуал калибровки (собранный кубик первым каждую
  сессию, ΔE red/orange санити); матрица условий (день / тёплый ЛН / холодный LED) × ≥2 кубика (стикерный +
  stickerless) × 1–2 человека; фикс-порядок/ориентация захвата; **≥20 чтений/условие**; правило гейта
  (min-over-conditions Wilson-LB ≥90% + drop-rate порог); ожидаемые hotspots (white/yellow, red/orange);
  **исключения** (mis-scramble, дрейф, resolve-fail — логировать, не считать как vision-fail); требование
  стандартной цветовой схемы (mirror-схема → не vision-fail); FAIL → **СТОП, пересмотр зрения (R1)**.
- **`.memory-bank/tasks/README.md`** — под гейтом 0.3 слинковать протокол + `/accuracy`.

## Blockers
Решений за тебя нет. Дизайн-форк (known-scramble vs solved) разрешён: **known-scramble основной** (тестит
красный/оранжевый адъяцентности — суть R1), solved — санити; циркулярность выравнивания снята **фиксированным
порядком/ориентацией захвата** (не выводим из чтения).

## Out of scope
- Правка `accuracy.ts` (переиспользуется как есть).
- Quota-based hand-mix ground truth / устранение degeneracy `gateHandMix` (флаг, не строим).
- Серверная персистентность/auth/экспорт кроме clipboard.
- Быстрая подстройка 1 гранью / потребление профиля в ритуале (отдельная vision-интеграция, не гейт 0.3).
- Hands FSM / таймер / solve-save.
- Автоматизация ручного гейта headless (невозможно без камеры+кубиков).
- Мобилка.

## Assumptions
- Скоримые ground truths независимы от чтения: SOLVED (solved) и `scrambleToFacelets` (scramble), через `scoreRead`.
- Аккумулятор (`accuracyRun.ts`) — NEW: `accuracy.ts` скорит одно чтение и не имеет cross-read стейта.
- `/accuracy` — dev/QA-инструмент, не прод-фича: dev-only lazy-роут, без auth/сервера, отчёт в буфер.
- Фикс-порядок захвата U,R,F,D,L,B при «белый верх, зелёный к себе» — тестер держит ориентацию (протокол).
- Значимость: ≥20 чтений/условие (~1080 стикеров), Wilson-LB, red↔orange/white↔yellow с явным N.
- Протокол — русский, в `docs/qa/`. Тесты — `frontend/tests/**`, `npm run test`.
