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

## Осталось (полный walkthrough — в работе)
`scramble.ts` (CDN-обёртка) · `walkthrough.ts` (чистая шаг-машина) · `moveCopy.ts`
(токен→рус подпись) · `twisty.ts` (обёртка twisty-player, CDN) · `main.ts` · `index.html` /
`style.css` · `tests/{walkthrough,moveCopy}.test.ts` · `README.md`. Плюс убрать временный
`vite.config` (input=spike.html) → дефолт index.html.
