# Скан безопасности: локальный стенд + OWASP ZAP

## Почему не по проду

Активный скан ZAP шлёт тысячи настоящих запросов: регистрирует аккаунты, создаёт
дуэли и попытки, дёргает отправку почты, упирается в рейт-лимиты. На
`cubr-game.ru` это мусор в базе, спалённая квота Resend и уложенный 1-vCPU
сервер. Пассивный проход (просто ходить по сайту через прокси ZAP) по проду
безопасен, активный — нет.

Стенд ниже отдаёт **тот же продовый бандл под теми же security-заголовками**, но
по `http://127.0.0.1:4173` и в локальную базу.

## Поднять стенд

```bash
# 1. база (если не запущена)
pg_isready -h 127.0.0.1 -p 5432 || brew services start postgresql@16

# 2. API
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. фронт: прод-сборка + превью-сервер с продовыми заголовками
cd frontend && npm run build && npm run preview
```

Стенд: <http://127.0.0.1:4173>. `/api/*` проксируется на FastAPI с тем же
срезанием префикса, что в Caddy, — origin один, поэтому httpOnly-кука
`cubr_auth`, SameSite=Lax и Origin-проверка дуэльного WebSocket ведут себя как в
проде.

Проверить заголовки:

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:4173/
curl -sS -D - -o /dev/null http://127.0.0.1:4173/api/health
```

## Порядок в ZAP

1. **Пассивный проход.** «Ручной обзор» / Manual Explore → `http://127.0.0.1:4173`
   → Launch Browser. Пройти руками: регистрация, вход, профиль, скрамбл, дуэль,
   друзья, турнир. ZAP пишет дерево Sites и сразу даёт пассивные алерты.
2. **Spider + Ajax Spider.** ПКМ на узле → Attack → Spider, затем Ajax Spider:
   SPA на React, обычный паук роутов не увидит.
3. **Контекст.** Ограничить скоуп `http://127.0.0.1:4173.*`, иначе скан пойдёт
   долбить `cdn.cubing.net` и `cdn.jsdelivr.net` — чужие хосты.
4. **Аутентификация.** Кука httpOnly, поэтому проще всего залогиниться в браузере
   ZAP на шаге 1: кука уезжает в сессию ZAP сама, отдельный Authentication
   Method настраивать не нужно.
5. **Активный скан.** ПКМ на узле → Attack → Active Scan. В политике снять
   правила, к нашему стеку не относящиеся (Buffer Overflow, Format String) и
   оставить инъекции, XSS, path traversal, SQLi.
6. **Отчёт.** Report → Generate HTML Report.

Рейт-лимиты (`AUTH_RATE_LIMIT` и соседи в `.env`) активный скан упрёт в 429 и
завалит покрытие. На время скана их можно поднять в `backend/.env` — но только на
локальном стенде, и вернуть обратно после.

## Security-заголовки

Один источник правды — `deploy/security-headers.json`. Из него:

- `deploy/scripts/gen-security-headers.mjs` рендерит `deploy/security-headers.caddy`,
  который импортирует `deploy/Caddyfile` (прод);
- `frontend/vite.config.ts` кормит тот же список превью-серверу (стенд).

Правишь JSON → `node deploy/scripts/gen-security-headers.mjs` → коммитишь оба
файла. `frontend/tests/security/headers.test.ts` падает, если сгенерированный
файл протух.

CSP держит белый список ровно тех внешних хостов, которые приложению нужны в
рантайме:

| Хост                                         | Зачем                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `cdn.cubing.net`                             | решатель скрамблов и `TwistyPlayer` грузятся как удалённые ESM-модули с воркерами (`src/scramble/cubingCdn.ts`) |
| `cdn.jsdelivr.net`                           | wasm MediaPipe (`src/vision/hooks/useHands.ts`)                                                                 |
| `storage.googleapis.com`                     | модель `hand_landmarker.task`                                                                                   |
| `fonts.googleapis.com` / `fonts.gstatic.com` | `@import` шрифтов в `src/index.css`                                                                             |

`'wasm-unsafe-eval'` нужен MediaPipe, `blob:` в `worker-src` — воркерам cubing.
`'unsafe-eval'` не выдан и выдавать не надо.

**После правки CSP обязательно открыть стенд в браузере и посмотреть консоль:**
нарушение CSP ничего не ломает в тестах и не видно в curl — оно просто молча
гасит скрамбл или камеру у живого пользователя. Проверять минимум: главную,
`/solo` (камера + wasm), страницу со скрамблом, шрифты.
