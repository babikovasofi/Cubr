# prototype2 — визуальный walkthrough скрамбла (dirty spike)

Отдельный throwaway-прототип фичи «визуальные инструкции скрамбла»
([spec](../.memory-bank/product-overview/feature-scramble-visual.md)) на
**cubing.js / `<twisty-player>`**. Не связан с `prototype/` (Этап-0 зрение).

Показывает случайный 3×3 скрамбл по шагам: анимированный кубик + русская подпись
направления каждого хода + прогресс + мини-карта + тумблер нотации. Кубик держать
**белым верхом, зелёным к себе**.

## Важно: cubing грузится с CDN, не бандлится
`cubing` гоняет solver в module web-worker; под Vite prod-build инстанцирование
воркера падает («Module worker instantiation failed» — dev ок, prod нет). Поэтому
`cubing/scramble` и `cubing/twisty` грузятся с `cdn.cubing.net` (remote ESM), как
MediaPipe в vision-риге. Рантайм требует сети. Подробности —
[swarm-report/scramble-walkthrough-proto-build.md](../swarm-report/scramble-walkthrough-proto-build.md).

## Запуск
```
npm install
npm run dev -- --host 127.0.0.1     # http://127.0.0.1:5173 (или :5174)
npm run build                        # tsc && vite build
npm run preview -- --host 127.0.0.1  # прод-сборка
npm test                             # Vitest: чистая логика walkthrough + moveCopy
```

## Что доказывает / НЕ доказывает
- ✅ cubing + twisty-player работают под Vite (dev и prod, через CDN); UX walkthrough.
- ❌ НЕ доказывает, что новичок соберёт физически верный скрамбл — без камеры
  ориентация «на честном слове». Физкорректность → Этап 1 (там камера). Приложение
  показывает **задуманное** состояние, не твой реальный кубик.

## Статус
Throwaway. Чистые `walkthrough.ts` / `moveCopy.ts` переживут порт в React (Этап 1);
`twisty.ts` / `main.ts` перепишутся под React-обёртку twisty-player.
