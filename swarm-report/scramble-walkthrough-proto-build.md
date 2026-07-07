# Build: Прототип walkthrough скрамбла   (slug: scramble-walkthrough-proto)

План: [scramble-walkthrough-proto-plan.md](scramble-walkthrough-proto-plan.md).

## Гейт-спайк (Шаг 1) — ✅ ПРОЙДЕН, с находкой
**Вопрос плана:** заводится ли `cubing` (scramble) + `<twisty-player>` под Vite в dev И prod?

**Находка (де-риск):** `cubing` через npm **бандлится, но падает в проде в рантайме** —
`randomScrambleForEvent` гоняет solver в **module web-worker**; оба fallback'а cubing —
module-worker; под Vite prod-build инстанцирование воркера падает: `Module worker
instantiation failed. There are no more fallbacks available.` Dev работает, prod нет — та же
асимметрия, что у cubejs. `vite worker.format:"es"` НЕ помог.

**Решение:** грузить cubing с **официального CDN `cdn.cubing.net/v0/js/cubing/{scramble,twisty}`**
(ESM), а не бандлить — CDN-сборка cubing правильно связывает воркеры, минуя бандлинг Vite.
Тот же паттерн, что уже используется для MediaPipe wasm/model. Рантайм требует сети; бандл
приложения крошечный (cubing не в нём).

**Проверено (spike.html / spike.ts):**
- `npm run build` (tsc && vite build) → exit 0, `spike.js` 2.69 kB (cubing не бандлится).
- dev :5174 → скрамбл `randomScrambleForEvent('333')` = 21 ход (только слои, без x/y/z),
  `<twisty-player>` смонтирован, консоль чистая.
- **prod dist :4174 → работает** (21-ходовый скрамбл, twisty смонтирован) — рантайм-тест,
  как у cubejs.

## Полный walkthrough — ✅ готово
Файлы `prototype2/`: `cubingCdn.ts` (CDN-загрузчик, кэш) · `scramble.ts` · `walkthrough.ts`
(чистая шаг-машина) · `moveCopy.ts` (токен→рус подпись направления, source of truth) ·
`twisty.ts` (обёртка twisty-player, фикс ориентация white-top/green-front) · `main.ts` ·
`index.html` / `style.css` · `tests/{walkthrough,moveCopy}.test.ts` · `README.md`.
spike.html/spike.ts/vite.config удалены (дефолтный index.html; cubing с CDN не бандлится).

**tests_result:**
```
npx tsc --noEmit → exit 0
npm test         → 9 passed (2 файла: walkthrough, moveCopy)
npm run build    → exit 0, index.js 6.56 kB (cubing не в бандле)
```

**Smoke (браузер, dev :5174 И prod dist :4174):**
- Скрамбл 21 ход загружен с CDN, `<twisty-player>` смонтирован, step-view показан.
- «Шаг N из 21» + бар; направление «R — Правый слой: поверни от себя вверх» (токен+рус).
- «дальше →» двигает шаг/направление/подсветку чипа (21 чип мини-карты); prev/клавиши/goto.
- Тумблер нотации: показывает строку скрамбла, сохранение в localStorage (=1). Консоль чистая.
- **Прод-сборка работает** (тот самый воркер-риск снят через CDN).

**Осталось (ручная QA):** живой человек с кубиком проходит скрамбл по анимации+подписям —
проверить понятность (comprehension). Анимация хода — twisty проигрывает alg от начала при
смене шага (грубовато; тонкую timeline-анимацию отложить в Этап 1). Физкорректность —
Этап 1 (камера).
