# Tech Details — Cubr

> Стек, архитектура, модули. Детали: [solutions.md](solutions.md) (как решать
> зрение/реалтайм/анти-чит), [user-flow.md](user-flow.md) (экраны),
> [design-system.md](design-system.md) (дизайн).

## Стек

| Слой | Выбор | Почему |
|---|---|---|
| Фронтенд | **React + TypeScript (Vite) + Tailwind** | Лучшая экосистема для камеры/CV в браузере |
| Зрение: руки | **MediaPipe Tasks Vision — HandLandmarker (JS)** | Актуальный API (legacy `@mediapipe/hands` устарел); детект рук в браузере |
| Зрение: кубик | **Своя логика**: canvas + Lab/ΔE классификация цветов | ML/CV-зона проекта; готовых JS-решений нет |
| Кубик-логика | **cubejs** (Этап 0) → **`cubing` / twisty-player** (Этап 1) | Скрамбл→эталон + рендер/анимация ходов; `cubing` даёт и random-state, и рендер — одна зависимость. Замена cubejs при визуальном скрамбле (см. [feature-scramble-visual](../product-overview/feature-scramble-visual.md)) |
| Бэкенд | **Python + FastAPI** | WebSockets и async из коробки; серверная CV на OpenCV |
| Реалтайм | **WebSockets (FastAPI)** | Комнаты дуэлей, статусы, синхронный старт |
| БД | **PostgreSQL + SQLAlchemy** (async; локально можно с SQLite) | Реляционка: игроки, дуэли, результаты, турниры |
| Авторизация | **fastapi-users**: email+пароль (argon2) + Google OAuth, JWT в httpOnly cookies | Не писать безопасность с нуля |
| Почта | **Resend / Brevo** (не свой SMTP) + SPF/DKIM | Подтверждение/сброс не в спам |
| Планировщик | **APScheduler** | Смена скрамбла недели, финализация таблицы (ночь пн) |
| Хостинг | Фронт — **Vercel**; бэк + Postgres — **Railway / Render** | Бесплатный старт |

## Архитектура

```
Браузер (React + TS + MediaPipe JS + логика кубика)
   │  REST      — логин, профиль, результаты, лидерборд
   │  WebSocket — дуэль: матчмейкинг, статусы, старт, финиш
   │  Кадры     — ключевые снимки (JPEG) для серверной валидации
   ▼
FastAPI (Python)
   ├─ генерация скрамблов, проверка состояния кубика (OpenCV)
   ├─ валидация таймингов/последовательности событий, начисление кубков
   ├─ матчмейкинг, комнаты дуэлей (ConnectionManager: room_id → {player_id → ws})
   └─ недельные турниры (APScheduler: смена скрамбла раз в неделю)
   │
   ▼
PostgreSQL
```

Реалтайм: состояние комнаты живёт на сервере (память процесса; Redis для MVP не
обязателен). Синхронный старт по серверному сигналу 3-2-1. Heartbeat 5с, отвал
15с. Reconnect по `room_id + session_token` со снапшотом комнаты. Подробнее — [solutions.md §П6](solutions.md).

## Модель данных (набросок)

```
users:        id, email, password_hash, google_id?, nickname, avatar_url,
              cups, best_single_ms, best_ao5_ms, created_at
duels:        id, mode (fast|ao5), scramble(s), player1_id, player2_id,
              status, winner_id, created_at
solves:       id, user_id, duel_id?, tournament_id?, scramble, time_ms,
              status (valid|dnf|rejected), verify_frames_ok, created_at
tournaments:  id, week_start, scramble, status
attempts:     unique(user_id, tournament_id)  — одна попытка/неделя (enforce в БД)
trophy_log:   id, user_id, delta, reason, created_at
```

## Тулчейн прототипа Этапа 0 (решено 2026-07-06)
**Vite + TypeScript** (vanilla-ts, без React — throwaway), пакеты через npm:
`@mediapipe/tasks-vision` (HandLandmarker), `cubejs`. Тесты — Vitest. Тот же
тулчейн, что Этап 1 → порт бесплатный. React/Tailwind/Zustand добавляются в Этапе 1.

**Gotcha (cubejs + Vite 8/Rolldown):** cubejs `lib/solve.js` использует
`this.Cube || require('./cube')` — top-level `this` в ESM = undefined → краш при
загрузке в браузере (dev и prod), но НЕ в Node-тестах/build. Пофикшено
`patch-package` (`prototype/patches/cubejs+1.3.2.patch`, `postinstall`).

**Gotcha (cubing + Vite):** `cubing` (заменит cubejs в Этапе 1) гоняет solver в
**module web-worker** — под Vite prod-build инстанцирование воркера падает
(«Module worker instantiation failed»; dev ок, prod нет; `worker.format:"es"` не
помог). Решение: грузить `cubing` с **CDN `cdn.cubing.net/v0/js/cubing/{scramble,twisty}`**
(remote ESM), НЕ бандлить — доказано в `prototype2/` (spike). Рантайм требует сети. MediaPipe
wasm+модель грузятся с CDN (пин 0.10.35) — рантайм требует сети. Vite биндит IPv6
по умолчанию → dev-запуск с `--host 127.0.0.1`.

## Ключевые фронт-модули (план Этапа 1)
`vision/hands.ts` (MediaPipe + зоны/неподвижность) · `vision/cube.ts` (рамка-гид,
сетка 3×3, чтение наклеек) · `vision/colors.ts` (Lab/ΔE, эталоны сессии, квоты 9×6) ·
`vision/fsm.ts` (конечный автомат: NO_HANDS→HANDS_IN_ZONE→READY→SOLVING→STOPPED).
Таймер: `performance.now()` + `requestVideoFrameCallback` (не привязан к кадрам). Состояние UI — Zustand.

## Внешние сервисы / контракты
- **WS-протокол** дуэли описать в `docs/ws-protocol.md` (join, status_update, countdown, start, finish, opponent_left).
- **События честности** (клиент→сервер): `scramble_shown, scramble_verified, hands_ready, solve_start, solve_stop, cube_verified` — сервер ставит свои таймстампы.
- **Почта:** Resend/Brevo API (async background task).
- **Хранилище кадров:** S3-совместимое или папка (MVP), TTL 7 дней.
