#!/usr/bin/env bash
# Ships the current working tree to the production VPS.
#
# The server holds no git repository: backend sources live at /srv/backend as a
# copy and the frontend is pre-built static under /srv/cubr/www. That is a
# deliberate trade (no toolchain, no credentials and no build load on a 1-vCPU
# box) but it means the ONLY reproducible path to production is this script —
# a server updated by hand drifts away from the repository silently.
#
# Order matters and is not cosmetic:
#   1. build the frontend locally      — a broken build must stop the deploy
#                                        BEFORE anything on the server changes
#   2. ship backend sources
#   3. build the API image
#   4. run migrations                  — a failed migration stops here, with the
#                                        old container still serving traffic
#   5. restart the API, then ship the new static
#   6. smoke-check, and say plainly if it fails
#
# Usage: deploy/scripts/deploy.sh [host]

set -euo pipefail

HOST="${1:-deploy@135.106.181.244}"
SITE="${SITE:-https://cubr-game.ru}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

say() { printf '\n=== %s ===\n' "$1"; }

say "0/6 рендер security-заголовков"
# The Caddy snippet is generated, so regenerate it here rather than trusting that
# whoever edited security-headers.json remembered to run the script.
node "$REPO_ROOT/deploy/scripts/gen-security-headers.mjs"

say "1/6 сборка фронтенда локально"
# Built here, never on the server: the box has one core and two gigabytes, and
# a build that fails must fail before production is touched.
(cd "$REPO_ROOT/frontend" && npm ci --silent && npm run build)

say "2/6 отправка исходников бэкенда"
rsync -az --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
  --exclude '.env' --exclude 'dev.db' \
  "$REPO_ROOT/backend/" "$HOST:/srv/backend/"

say "3/6 сборка образа API"
ssh "$HOST" 'cd /srv/cubr && docker compose build api'

say "4/6 миграции базы"
# Runs against the live database with the OLD container still up. A failure
# here leaves production exactly as it was.
ssh "$HOST" 'cd /srv/cubr && docker compose run --rm api alembic upgrade head'

say "5/6 конфиг стека, перезапуск API, заливка статики"
# The stack definition ships from the repository too: the security headers live
# in security-headers.caddy (generated from security-headers.json) and are mounted
# into the caddy container by docker-compose.yml, so a server whose copies were
# edited by hand drifts away from what the local ZAP stand scans. Shipped BEFORE
# `up -d`, since the compose file is what declares that mount.
rsync -az \
  "$REPO_ROOT/deploy/docker-compose.yml" \
  "$REPO_ROOT/deploy/Caddyfile" \
  "$REPO_ROOT/deploy/security-headers.caddy" \
  "$HOST:/srv/cubr/"
ssh "$HOST" 'cd /srv/cubr && docker compose up -d'
rsync -az --delete "$REPO_ROOT/frontend/dist/" "$HOST:/srv/cubr/www/"
# Reload, not restart: Caddy re-reads the config with zero downtime, and a broken
# config makes it keep the running one and fail here rather than drop TLS. `up -d`
# above only recreates the container when the mount list itself changed.
ssh "$HOST" 'cd /srv/cubr && docker compose exec -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile'

say "6/6 смоук"
# The API needs a few seconds to boot after `up -d` returns: uvicorn starts,
# opens the pool and only then answers. Smoking immediately reports a 502 for a
# deploy that is in fact fine — and a deploy script that cries wolf teaches the
# person running it to ignore a red verdict, which is worse than having no
# check at all. So: wait for readiness, with a bounded patience.
printf 'жду готовности API'
for _ in $(seq 1 30); do
  if [ "$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/api/health")" = "200" ]; then
    printf ' — готов\n'
    break
  fi
  printf '.'
  sleep 2
done

code_root=$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/")
code_api=$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/api/health")
code_spa=$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/rules")
echo "главная $code_root · /api/health $code_api · /rules $code_spa"

if [ "$code_root" = "200" ] && [ "$code_api" = "200" ] && [ "$code_spa" = "200" ]; then
  echo "ВЫКАТКА УСПЕШНА: $SITE"
else
  echo "ВЫКАТКА НЕ ПОДТВЕРЖДЕНА — сайт отвечает не 200. Смотри логи:"
  echo "  ssh $HOST 'cd /srv/cubr && docker compose logs --tail=50 api caddy'"
  exit 1
fi
