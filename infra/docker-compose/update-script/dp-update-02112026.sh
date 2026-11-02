#!/usr/bin/env bash
# Update script run by dp-cron-production.sh / dp-cron-staging.sh: backs up
# the database, starts the containers from the downloaded compose file and
# checks the API health.
#
# By default, the logs are written to .dp-cron-files/logs/update-job.log
# Requires docker and curl. pg_dump runs inside the PG_IMAGE container.
#
# Inputs (exported by dp-cron-*.sh, all optional):
#   DP_COMPOSE_FILE  compose file to start (default: ~/docker-compose.yml)
#   DP_CRON_ACTION   "update" or "rollback"; the backup is skipped on rollback
#   NEW_VERSION / CURRENT_VERSION  version the API must report afterwards
#   POSTGRES_URL     database to back up (default: read from ~/.env)

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/health}"
DP_COMPOSE_FILE="${DP_COMPOSE_FILE:-$HOME/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$HOME/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
PG_DOCKER_NETWORK="${PG_DOCKER_NETWORK:-host}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-5}"

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# dp-cron-*.sh downloads this script into its own .dp-cron-files directory
# and runs it from there, so reuse that directory instead of nesting another.
if [ -n "${DP_CRON_FILES:-}" ]; then
  STATE_DIR="$DP_CRON_FILES"
elif [ "$(basename "$SCRIPT_DIR")" = ".dp-cron-files" ]; then
  STATE_DIR="$SCRIPT_DIR"
else
  STATE_DIR="$SCRIPT_DIR/.dp-cron-files"
fi
LOG_FILE="${UPDATE_LOG_FILE:-$STATE_DIR/logs/update-job.log}"
LOCK_FILE="$STATE_DIR/dp-update.lock"
LOCK_DIR="$STATE_DIR/dp-update.lock.d"
BACKUP_DIR="$STATE_DIR/backup"
BACKUP_FILE="$BACKUP_DIR/data-platform.dump"

if ! mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR" || ! touch "$LOG_FILE"; then
  echo "dp-update: cannot write to $LOG_FILE or $BACKUP_DIR" >&2
  exit 1
fi
exec >>"$LOG_FILE" 2>&1

log() {
  printf '%s [dp-update:%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$$" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 8>"$LOCK_FILE"
    flock -n 8
    return
  fi

  # No flock (e.g. macOS): mkdir is atomic, and the stored PID lets a lock
  # left behind by a killed run be reclaimed.
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local pid
    pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    log "Removing stale lock left by PID $pid"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || return 1
  fi
  echo "$$" >"$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
}

# Reads KEY from the .env file without sourcing it.
read_env_var() {
  local key="$1" line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

# Runs a PostgreSQL client command in a throwaway container. The URL is passed
# through the environment so the password does not show up in `ps`.
pg_run() {
  PGURL="$DB_URL" docker run --rm --network "$PG_DOCKER_NETWORK" \
    -e PGURL -e PGCONNECT_TIMEOUT=10 "$PG_IMAGE" sh -c "$1"
}

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$DP_COMPOSE_FILE" "$@"
  else
    docker compose -f "$DP_COMPOSE_FILE" "$@"
  fi
}

if ! acquire_lock; then
  log "Another dp-update run is in progress; exiting."
  exit 0
fi

ACTION="${DP_CRON_ACTION:-update}"
if [ "$ACTION" = "rollback" ]; then
  EXPECTED_VERSION="${CURRENT_VERSION:-}"
else
  EXPECTED_VERSION="${NEW_VERSION:-}"
fi
log "Starting $ACTION${EXPECTED_VERSION:+ to $EXPECTED_VERSION} using $DP_COMPOSE_FILE"

command -v docker >/dev/null 2>&1 || fail "docker is not installed."
docker info >/dev/null 2>&1 \
  || fail "Cannot connect to the Docker daemon; check that it is running and this user is in the docker group."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
[ -s "$DP_COMPOSE_FILE" ] || fail "Compose file $DP_COMPOSE_FILE is missing or empty."

POSTGRES_URL="${POSTGRES_URL:-}"
if [ -z "$POSTGRES_URL" ]; then
  POSTGRES_URL="$(read_env_var POSTGRES_URL)"
fi
[ -n "$POSTGRES_URL" ] || fail "POSTGRES_URL is not set in the environment or in $ENV_FILE."
DB_URL="${POSTGRES_URL/+asyncpg/}"

pg_run 'psql -d "$PGURL" -X -q -A -t -c "SELECT 1"' >/dev/null \
  || fail "The database in POSTGRES_URL is not reachable."
log "Database is reachable."

# A rollback follows a failed update; keep the backup taken before that update.
if [ "$ACTION" = "rollback" ]; then
  log "Skipping the database backup during rollback; keeping $BACKUP_FILE"
else
  log "Backing up the database to $BACKUP_FILE"
  if ! pg_run 'pg_dump -d "$PGURL" -Fc' >"$BACKUP_FILE.tmp" || [ ! -s "$BACKUP_FILE.tmp" ]; then
    rm -f "$BACKUP_FILE.tmp"
    fail "pg_dump failed; the containers were not changed."
  fi
  mv -f "$BACKUP_FILE.tmp" "$BACKUP_FILE"
  log "Database backup saved ($(du -h "$BACKUP_FILE" | cut -f1))."
fi

log "Starting the containers"
compose up -d --quiet-pull || fail "docker compose up failed (a failed migration also ends up here)."
log "docker compose up completed."

log "Waiting for $HEALTH_URL"
attempt=1
while :; do
  # Nginx redirects HTTP to HTTPS, and its certificate is issued for DOMAIN,
  # not 127.0.0.1, so follow the redirect without verifying the certificate.
  health="$(curl -fsSLk --max-time 10 "$HEALTH_URL" 2>/dev/null || true)"
  if [[ "$health" == *'"healthy"'* ]]; then
    if [ -z "$EXPECTED_VERSION" ] || [[ "$health" == *"\"$EXPECTED_VERSION\""* ]]; then
      break
    fi
    log "API is healthy but reports $health; expected version $EXPECTED_VERSION."
  fi
  if (( attempt >= HEALTH_ATTEMPTS )); then
    compose ps
    fail "The API did not become healthy${EXPECTED_VERSION:+ on $EXPECTED_VERSION} after $HEALTH_ATTEMPTS attempts."
  fi
  attempt=$((attempt + 1))
  sleep "$HEALTH_INTERVAL_SECONDS"
done
log "API health check passed: $health"

log "updation to the latest version is successfully completed."
