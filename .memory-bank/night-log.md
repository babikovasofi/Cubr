# Ночной журнал деплоя на VPS — 2026-08-18

Исполняется по `swarm-report/deploy-vps-plan.md`. Пользователь спит, решения по
плану приняты заранее.

## Фаза 1. Дозакрыть сервер

Задача: включить ufw (только 22/80/443), выключить парольный вход по SSH,
оставить root только по ключу (`prohibit-password`).

Файлы: `/etc/ssh/sshd_config`, `/etc/ssh/sshd_config.d/50-cloud-init.conf` (на
сервере, вне репозитория).

Ход: `ufw` был `inactive` — включил с default deny incoming, разрешил
22/80/443, проверил, что `deploy@` всё ещё пускает, только после этого правил
sshd. В `/etc/ssh/sshd_config` `PasswordAuthentication` уже стоял `no`, но
`sshd_config.d/50-cloud-init.conf` (Ubuntu 24.04 кладёт override туда)
переопределял его обратно на `yes` — поправил и там, иначе основной файл лгал.
`PermitRootLogin` выставил в `prohibit-password` (не `no` — вход root по ключу
нужен этому же деплою).

Проверка: `sshd -t` — тихо; `ssh deploy@…` и `ssh root@…` по ключу работают
после `systemctl reload ssh`; `ufw status` показывает ровно три разрешённых
порта (22, 80, 443, v4 и v6).

Итог: **успех**.

## Фаза 2. Артефакты деплоя в репозитории

Задача: ветка `feat/deploy-vps` от `main`, `deploy/docker-compose.yml`,
`deploy/Caddyfile`, `deploy/.env.example`, переписать `docs/deploy.md` под VPS
вместо Railway.

Файлы: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`,
`docs/deploy.md`.

Ход: три сервиса (`db`, `api`, `caddy`) в сети `172.28.0.0/16`, у `caddy`
статический `172.28.0.10` (нужен `TRUSTED_PROXIES`). `db` без публикации
порта, `shared_buffers=256MB`, `max_connections=50` под 2 ГБ RAM. `api` без
публикации порта, собирается из `../backend`. `caddy` — единственный с портами
80/443, тома `caddy_data`/`caddy_config` для сертификатов. `Caddyfile` —
`strip_prefix /api` + `try_files … /index.html` для SPA-роутинга.
`deploy/.env.example` — прод-версия `backend/.env.example` плюс
`POSTGRES_PASSWORD`/`SITE_DOMAIN` для compose/Caddy. Проверил, что
`deploy/.env` попадает под существующий `.gitignore` (`.env`/`.env.*` без
слэша матчатся в любой директории) — отдельное правило не нужно.
`docs/deploy.md` переписан целиком под этот стек, разделы «Смоук» и «Откат»
сохранены и расширены под docker/бэкапы. `backend/railway.json` не тронут —
он не путь деплоя, но всё ещё документирует `numReplicas: 1`.

Проверка: `docker compose -f docker-compose.yml config` (на сервере, с
одноразовым `.env` из плейсхолдеров `POSTGRES_PASSWORD=dummy…`,
`SITE_DOMAIN=example.invalid`, никаких секретов) — разобрался без ошибок,
exit 0. Временная папка на сервере удалена сразу после проверки.

Итог: **успех**. Коммит `1b7dc92`.

## Фаза 3. Сборка фронта

Задача: собрать `frontend/dist` локально (не на сервере — 1 vCPU/2 ГБ), залить
на сервер.

Ход: `npm ci` (374 пакета), `npm run build`. `prebuild` предупредил про
плейсхолдер `REPLACE_WITH_BACKEND_URL_AT_DEPLOY` в `vercel.json` — ожидаемо,
Vercel не используется, проксирование делает Caddy. `postbuild`: входной чанк
273.9 kB / 320 kB — в бюджете. `rsync -az --delete` в
`/srv/cubr/www` (каталог создан заранее, `deploy:deploy`, `sudo mkdir` — до
этого `/srv/cubr` не существовал).

Проверка: `/srv/cubr/www/index.html` существует; локальный `dist` — 704K,
удалённый каталог — 712K (разница — блочные накладные расходы ФС, не
контент).

Итог: **успех**.

## Отступление от буквы плана перед Фазой 4

Build context `api: build: context: ../backend` требует backend-исходники на
сервере рядом с `/srv/cubr` (`/srv/backend`) — в плане это не расписано
отдельным шагом. Залил только отслеженные git файлы (`git ls-files` в backend,
107 файлов, без `.venv`, без `.env`) через `rsync --files-from`, чтобы не
тащить ничего лишнего. `/srv/backend` создан `sudo mkdir` + `chown
deploy:deploy`, как раньше `/srv/cubr`.

Также решил не поднимать `caddy` в конце Фазы 4 вместе с `db`/`api`: на момент
Фазы 4 `SITE_DOMAIN` ещё не определён (DNS проверяется в Фазе 5), а Caddy при
пустом домене либо не стартует, либо начнёт долбить Let's Encrypt не тем
именем. Подниму `caddy` в Фазе 5 после того, как решится домен —
`docker compose up -d` идемпотентен, просто разделил его на два вызова вместо
одного, поведение то же.

## Фаза 4. Поднять стек и накатить миграции

Задача: секреты на сервере, `.env` (600, `deploy`), `db` → миграции → `api`.

Ход: пять секретов сгенерированы каждый своей командой `python3 -c
"import secrets; print(secrets.token_urlsafe(48))"` прямо на сервере, значения
никогда не проходили через мой собственный вывод — писал `.env` одним
remote-скриптом, значения оставались в переменных shell на сервере и в файл.
`.env` — 59 строк, ровно 5 пустых ключей (`SITE_DOMAIN`, `RESEND_API_KEY`,
`BREVO_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` —
почта и OAuth осознанно отложены). `TRUSTED_PROXIES=172.28.0.10`,
`DATABASE_URL=postgresql+asyncpg://cubr:<pw>@db:5432/cubr`, `WEB_CONCURRENCY=1`.

`docker compose up -d db` → healthy за 4 попытки (~8с). `docker compose build
api` — собрался (uv sync, 2 стадии) без правок кода. `docker compose run --rm
api alembic upgrade head` — все 10 миграций (0001…0010) накатились на пустую
базу чисто, без ошибок. `docker compose up -d db api` — оба контейнера
подняты, порты 5432 и 8000 не опубликованы в хост (видно в `docker compose
ps` — `PORTS` пустой снаружи).

Проверка: `docker compose ps` — `db` healthy, `api` running;
`docker compose exec -T api python -c "import app.main"` — не упал;
health-check изнутри сети — `200 {"status":"ok","db":"ok"}` (значит и
`SELECT 1` в базе тоже прошёл).

Итог: **успех**.

## Фаза 5. Домен и HTTPS — запущено параллельно с Фазой 6

`dig +short A cubr-game.ru` на момент старта — пусто (и с системного резолвера,
и с 8.8.8.8/1.1.1.1). Запустил фоновый поллер: проверка раз в 10 минут, до 13
попыток (2 часа), критерий успеха — A-запись равна `135.106.181.244` точно.
Пока идёт ожидание, шёл по Фазе 6 (она не зависит от домена). Итог Фазы 5 и
поднятие `caddy` — отдельной записью ниже, после того как поллер завершится
(резолвится или истекут 2 часа → sslip.io).

## Фаза 6. Cron и бэкапы

Задача: `*/5` finalize, ежедневный `pg_dump` с хранением 14 дней, ротация
логов.

Ход: crontab `deploy` — две строки, обе по тексту плана (пути `/usr/bin/docker
compose`, лог в `/var/log/cubr-finalize.log`, дамп в `/srv/cubr/backups`).
`/etc/logrotate.d/cubr` на `/var/log/cubr-*.log`, weekly, 4 ротации, gzip.
`logrotate -d` сперва отругался: `/var/log` группово-писуема (`syslog`), это
«insecure permissions» с точки зрения logrotate при ротации от root. Полечил
двумя правками (это конфиг сервера, не app-код, в границы плана укладывается):
файл лога создан заранее `touch` + `chown deploy:deploy` (иначе cron под
`deploy` не смог бы его создать — `/var/log` пишем только для `root:syslog`), в
конфиг logrotate добавлена директива `su deploy deploy`. После этого `logrotate
-d` проходит без предупреждений.

Проверка: `docker compose run --rm api python -m app.jobs.finalize` руками —
`swept 0 expired tournament attempts, 0 expired daily attempts (0 total)`,
exit 0 (на пустой базе ноль — ожидаемо). `pg_dump | gzip` вручную создал
`cubr-test-2026-08-17.sql.gz` (2902 байта, начало файла — валидный
`-- PostgreSQL database dump`), `gunzip -t` — ОК. Тестовый архив удалён после
проверки, чтобы не путать с настоящими ночными дампами.

Итог: **успех**.

## Фаза 5 (продолжение) — вмешательство координатора, sslip.io вместо ожидания DNS

Фоновый поллер DNS, запущенный ранее, не пережил рестарт исполнителя. Координатор
подтвердил состояние на момент вмешательства: `db` healthy, `api` up, `/srv/cubr/www`
заполнен, `caddy` не поднят, `cubr-game.ru` всё ещё без A-записи — и распорядился
не ждать: поднять сайт на fallback `135-106-181-244.sslip.io` сейчас, `cubr-game.ru`
подключить отдельно, когда A-запись появится (это уже не в скоупе этого прогона).

Ход: в `/srv/cubr/.env` переписаны все четыре origin-переменные согласованно —
`SITE_DOMAIN`, `CORS_ORIGINS`, `DUEL_ALLOWED_WS_ORIGINS`, `FRONTEND_URL` на
`https://135-106-181-244.sslip.io`, `GOOGLE_OAUTH_REDIRECT_URL` на
`https://135-106-181-244.sslip.io/api/auth/google/callback` (тот же паттерн, что и
для настоящего домена). `Caddyfile` не трогал — он и так читает домен из
`{$SITE_DOMAIN}`, `cubr-game.ru` в него не попадал ни разу, лимит Let's Encrypt не
расходовался на неверное имя. `docker compose up -d caddy` — образ подтянут,
контейнер поднят со статическим IP `172.28.0.10`; в логах `tls-alpn-01` challenge
прошёл за секунды, `certificate obtained successfully` для
`135-106-181-244.sslip.io` — один-единственный выпуск сертификата за весь прогон.

Проверка: `curl -sI https://135-106-181-244.sslip.io/` → `HTTP/2 200` (TLS-рукопожатие
прошло, иначе curl отказал бы сам); `curl https://…/api/health` →
`{"status":"ok","db":"ok"}`; прямой заход на `https://…/rules` → 200 (SPA-фолбэк
`try_files … /index.html` работает).

Итог: **успех**, но на fallback-адресе. `cubr-game.ru` — на утро, см. итоговый отчёт.

## Фаза 7. Смоук

Прогнан по `https://135-106-181-244.sslip.io`, все 10 пунктов чеклиста, годных без
камеры и второго человека:

| Пункт | Результат |
|---|---|
| `/` лендинг | `HTTP/2 200` |
| `/rules`, `/privacy` прямой ссылкой | 200, 200 |
| `/api/health` | 200 `{"status":"ok","db":"ok"}` |
| Регистрация | 201 |
| Вход → cookie | `Secure; HttpOnly; SameSite=lax` — все три флага на месте |
| `GET /api/users/me` с cookie | 200 |
| `GET /api/scramble` | строка + `scramble_token` |
| `POST /api/solves` с токеном | 201 |
| `GET /api/daily/current` | authed 200, аноним 401 |
| Рейт-лимит, 11 попыток входа | 400×9 (неверный пароль) → 429 на 10-й и 11-й — лимит
  сработал внутри 11 попыток, `TRUSTED_PROXIES=172.28.0.10` подтверждён живьём |

Смена языка RU/EN — **не проверена живьём**: это чисто клиентское состояние
(`langStore`), серверных зависимостей нет, curl-смоуком не покрывается; полагаюсь
на существующий фронтенд-тест-сьют (`langStore`/`i18n`), но живого браузерного
клика не было — честно помечаю как непроверенное в отчёте.

Тестовый пользователь `smoke-test-1786998651@example.com` удалён из БД
(`DELETE FROM "user" …`, каскадом ушла и его единственная сборка из `solves`).
Проверено: `SELECT count(*) FROM solves` = 0, `SELECT count(*) FROM "user"` = 0 —
база снова пустая, как и была до прогона.

Итог: **успех**, 10/10 автоматизируемых пунктов прошли, 1 пункт (RU/EN) честно
не проверен вживую.
