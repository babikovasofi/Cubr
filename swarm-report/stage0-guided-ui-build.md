# Build: Экранный гайд прототипа   (slug: stage0-guided-ui)

План: [stage0-guided-ui-plan.md](stage0-guided-ui-plan.md). Exec: `frontend`.

## Status: ✅ код + юнит-тесты + smoke гайд-слоя зелёные
Полный браузерный цикл с реальной камерой/кубиком — ручная QA (headless невозможно).

## Changed files (`prototype/`, CV/FSM/границы модулей не тронуты)
- `guide.ts` **(нов)** — чистая `guideStateFor(snapshot)` шаг-машина + весь русский
  копирайт (`FACE_LABELS_RU`, `COLOR_LABELS_RU`, тексты ошибок). Без DOM, без клик-счётчика.
- `accuracy.ts` — Mode A `gateHandMix(rawRead, resolved)` (сырая классификация vs
  legality-resolved эталон; `null` если легального эталона нет) + Mode B `gateSolved`
  (vs SOLVED). Старый `scoreRead` оставлен для продуктового пути.
- `main.ts` — `snapshot()` + `renderGuide/refreshGuide` в конце каждого хендлера И в
  хвосте `onFrame` (дебаунс по смене step/fsmState/error). `pushFace` возвращает
  URFDLB-выровненный `rawRead` (та же ротация, что резолвер) → raw и resolved про одни
  стикеры. Русские ошибки через `setError/lastError`; A/B-переключатель; reset-note при
  `collector!==null`; подписи в `drawOverlay`.
- `index.html` — блок `#guide` (заголовок/прогресс/сейчас/дальше + радио A/B) над `#panel`.
- `style.css` — `#guide` (жёлтый акцент, крупнее `#guide-now`), `.guide-next`/`.guide-dim`,
  `.guide-status-ok/bad`, `.reset-note`.
- `hands.ts` — `drawOverlay` опц. `labels?`; кириллица в локальном `scale(-1,1)` → читается
  прямо под CSS-зеркалом. Геометрия/детекция не изменены.
- `tests/guide.test.ts` **(нов)** — 16 тестов guideStateFor (шаги/activeButtonId/русские
  подстроки, прогресс калибровки по collector, ветки ошибок, без verify нет armTimer).

## Оба HIGH реализованы
- **Гейт для новичка (режим A):** нотация скрамбла убрана из петли — hand-mix, скоринг
  сырой классификации vs легально-разрешённое состояние. Гейт проходим без знания нотации.
- **Гайд = чистая проекция:** нет параллельного счётчика; step выводится из существующих
  переменных, рендер в двух точках (хендлеры + onFrame).

## tests_result
```
npx tsc --noEmit  → exit 0
npx vitest run    → 52 passed (52)  [4 файла; +16 guide.test]
npm run build     → exit 0
```

## Smoke гайд-слоя (браузер, dev :5173, без камеры)
- Панель рендерится по-русски, кириллица без кракозябр: «Шаг 1 — включи камеру» /
  «Нажми "Включить камеру"…» / «Дальше откалибруем 6 граней…».
- Рекомендованная кнопка подсвечена (`.guide-next` = btn-start); режимы handmix/solved.
- Клик Start (камера запрещена в headless) → гайд переходит в error-шаг:
  «Нет доступа к камере. Разреши камеру… и нажми ещё раз» (класс `guide-status-bad`),
  англ. debug остаётся в `#report`. Двухканальность работает. Консоль без ошибок.

## Осталось (ручная QA — только с живой камерой+кубиком)
Полный цикл: калибровка 6 граней → перемешать руками → verify → руки в зоны → таймер →
собрать → confirm → **accuracy Mode A**. Тюнинг порогов в `config.ts`. Гейт ≥90%.
