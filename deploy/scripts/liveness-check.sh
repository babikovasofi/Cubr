#!/usr/bin/env bash
# Liveness prober for the Cubr stack. Runs from host cron every 5 minutes.
#
# Checks two things over the public HTTPS endpoint: the site root (proves
# Caddy is serving) and /api/health (proves api + db are answering behind
# it). Every run is logged, pass or fail.
#
# Deliberately dumb: it restarts a container only after $THRESHOLD
# CONSECUTIVE failures of its probe — never on one bad probe, since a
# single timeout is normal noise, not an outage. After it does restart
# something, it won't act on that same probe again for $COOLDOWN seconds,
# so a container that's actually broken doesn't get restarted every five
# minutes forever — that's a flapping auto-restarter, worse than none. A
# human reading the log is expected to step in once a cooldown is hit.
#
# State (consecutive-failure counts, last-restart timestamps) lives in
# plain files under $STATE_DIR — one number per file, nothing fancier.

set -euo pipefail

COMPOSE_DIR=/srv/cubr
STATE_DIR=/var/lib/cubr-liveness
LOG=/var/log/cubr-liveness.log
THRESHOLD=3        # consecutive failures before we act
COOLDOWN=1800       # seconds after a restart before we'll act on the same probe again

mkdir -p "$STATE_DIR"

# SITE_DOMAIN is not a secret (it's the public hostname) — the four real
# secrets in .env are never read or printed here.
SITE_DOMAIN=$(grep -m1 '^SITE_DOMAIN=' "$COMPOSE_DIR/.env" | cut -d= -f2-)

log() {
    printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG"
}

# check NAME URL SERVICE
check() {
    local name="$1" url="$2" service="$3"
    local count_file="$STATE_DIR/${name}.count"
    local cooldown_file="$STATE_DIR/${name}.restarted_at"
    local code

    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)

    if [ "$code" = "200" ]; then
        log "$name OK ($url -> $code)"
        rm -f "$count_file"
        return
    fi

    local count=0
    [ -f "$count_file" ] && count=$(cat "$count_file")
    count=$((count + 1))
    echo "$count" > "$count_file"
    log "$name FAIL ($url -> $code), consecutive=$count"

    if [ "$count" -lt "$THRESHOLD" ]; then
        return
    fi

    local now last=0
    now=$(date +%s)
    [ -f "$cooldown_file" ] && last=$(cat "$cooldown_file")
    if [ $((now - last)) -lt "$COOLDOWN" ]; then
        log "$name at $count consecutive failures but restarted within the last ${COOLDOWN}s — not restarting again, needs a human"
        return
    fi

    log "$name failed $count times in a row, restarting container: $service"
    (cd "$COMPOSE_DIR" && /usr/bin/docker compose restart "$service") >> "$LOG" 2>&1
    echo "$now" > "$cooldown_file"
    rm -f "$count_file"
}

check site "https://${SITE_DOMAIN}/" caddy
check api "https://${SITE_DOMAIN}/api/health" api
