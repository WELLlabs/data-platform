#!/usr/bin/env bash
# Checks the release channel for a newer Data Platform version and runs that
# release's update script, rolling back to the running version if it fails.
#
# Cron (every Sunday at 03:00):
#   0 3 * * 0 /home/user/dp-cron-production.sh
# 
# By default, the logs are written to .dp-cron-files/logs/cron-job.log
# Requires curl, plus jq or python3 for reading JSON.

CHANNEL_URL="${CHANNEL_URL:-https://raw.githubusercontent.com/WELLlabs/data-platform/refs/heads/master/infra/docker-compose/channels/production.json}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/health}"
DP_COMPOSE_FILE="${DP_COMPOSE_FILE:-$HOME/docker-compose.yml}"

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$SCRIPT_DIR/.dp-cron-files"
LOG_FILE="${LOG_FILE:-$STATE_DIR/logs/cron-job.log}"
LOCK_FILE="$STATE_DIR/dp-cron.lock"
LOCK_DIR="$STATE_DIR/dp-cron.lock.d"
STATE_FILE="$STATE_DIR/cron.json"

if ! mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR" || ! touch "$LOG_FILE"; then
  echo "dp-cron: cannot write to $LOG_FILE or $STATE_DIR" >&2
  exit 1
fi
exec >>"$LOG_FILE" 2>&1

log() {
  printf '%s [dp-cron:%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$$" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    flock -n 9
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

json_valid() {
  if command -v jq >/dev/null 2>&1; then
    jq empty <<<"$1" >/dev/null 2>&1
  else
    python3 -c 'import json, sys; json.load(sys.stdin)' <<<"$1" >/dev/null 2>&1
  fi
}

# Prints the string at the given key path, or nothing if it is missing.
json_get() {
  local json="$1"
  shift
  if command -v jq >/dev/null 2>&1; then
    jq -r 'getpath($ARGS.positional) // empty | strings' --args "$@" <<<"$json" 2>/dev/null
  else
    python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in sys.argv[1:]:
    value = value.get(key) if isinstance(value, dict) else None
print(value if isinstance(value, str) else "")
' "$@" <<<"$json" 2>/dev/null
  fi
}

fetch_channel() {
  local json
  json="$(curl -fsSL --max-time 30 "$CHANNEL_URL")" || return 1
  json_valid "$json" || return 1
  printf '%s' "$json"
}

download() {
  local url="$1" dest="$2" tmp="$2.tmp"
  if curl -fsSL --max-time 120 -o "$tmp" "$url" && [ -s "$tmp" ]; then
    mv -f "$tmp" "$dest"
  else
    rm -f "$tmp"
    return 1
  fi
}

# Downloads and runs an update script; its exit status is returned.
run_update_script() {
  local url="$1" action="$2" file="$STATE_DIR/$2-script.sh"
  if ! download "$url" "$file"; then
    log "Could not download the $action script from $url"
    return 1
  fi
  log "Running the $action script from $url"
  DP_CRON_ACTION="$action" bash "$file" 9>&-
}

write_state() {
  printf '{\n  "previous_version": "%s",\n  "target_version": "%s",\n  "status": "%s",\n  "updated_at": "%s"\n}\n' \
    "$CURRENT_VERSION" "$NEW_VERSION" "$1" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"$STATE_FILE"
}

is_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

if ! acquire_lock; then
  log "Another dp-cron.sh run is in progress; exiting."
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is not installed."
command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 \
  || fail "Neither jq nor python3 is installed."

log "Checking $CHANNEL_URL for updates"

# Nginx redirects HTTP to HTTPS, and its certificate is issued for DOMAIN,
# not 127.0.0.1, so follow the redirect without verifying the certificate.
HEALTH_JSON="$(curl -fsSLk --max-time 15 "$HEALTH_URL")" \
  || fail "Could not reach $HEALTH_URL to read the current version."
CURRENT_VERSION="$(json_get "$HEALTH_JSON" version)"

CHANNEL_JSON="$(fetch_channel)" || fail "Could not fetch valid JSON from $CHANNEL_URL"
NEW_VERSION="$(json_get "$CHANNEL_JSON" latest version)"
NEW_DOCKER_COMPOSE="$(json_get "$CHANNEL_JSON" latest docker-compose)"
NEW_UPDATE_SCRIPT="$(json_get "$CHANNEL_JSON" latest update-script)"
MIN_VERSION="$(json_get "$CHANNEL_JSON" latest min-version)"

log "Current version: ${CURRENT_VERSION:-unknown}, latest version: ${NEW_VERSION:-unknown}, minimum version: ${MIN_VERSION:-unknown}"

if ! is_version "$CURRENT_VERSION" || ! is_version "$NEW_VERSION"; then
  fail "changes in version seen, but some problem with the version number"
fi

IFS=. read -r cur_x cur_y cur_z <<<"$CURRENT_VERSION"
IFS=. read -r new_x new_y new_z <<<"$NEW_VERSION"

update_available=false
if (( 10#$new_x > 10#$cur_x )); then
  update_available=true
elif (( 10#$new_x == 10#$cur_x )); then
  if (( 10#$new_y > 10#$cur_y )); then
    update_available=true
  elif (( 10#$new_y == 10#$cur_y )); then
    if (( 10#$new_z > 10#$cur_z )); then
      update_available=true
    elif (( 10#$new_z == 10#$cur_z )); then
      log "No update available; $CURRENT_VERSION is the latest version."
      exit 0
    fi
  fi
fi
$update_available || fail "changes in version seen, but some problem with the version number"

log "New version $NEW_VERSION is available."

is_version "$MIN_VERSION" || fail "min-version '$MIN_VERSION' for $NEW_VERSION is not in X.Y.Z format."
IFS=. read -r min_x min_y min_z <<<"$MIN_VERSION"

min_satisfied=false
if (( 10#$cur_x > 10#$min_x )); then
  min_satisfied=true
elif (( 10#$cur_x == 10#$min_x )); then
  if (( 10#$cur_y > 10#$min_y )); then
    min_satisfied=true
  elif (( 10#$cur_y == 10#$min_y )) && (( 10#$cur_z >= 10#$min_z )); then
    min_satisfied=true
  fi
fi
$min_satisfied || fail "current version of the application does not satisfy the minimum version requirement for updation"

[ -n "$NEW_DOCKER_COMPOSE" ] || fail "The latest entry has no docker-compose URL."
[ -n "$NEW_UPDATE_SCRIPT" ] || fail "The latest entry has no update-script URL."

export CURRENT_VERSION NEW_VERSION MIN_VERSION DP_COMPOSE_FILE LOG_FILE
write_state "updating"

download "$NEW_DOCKER_COMPOSE" "$DP_COMPOSE_FILE" \
  || fail "Could not download $NEW_DOCKER_COMPOSE to $DP_COMPOSE_FILE"
log "Saved the $NEW_VERSION compose file to $DP_COMPOSE_FILE"

if run_update_script "$NEW_UPDATE_SCRIPT" update; then
  write_state "updated"
  log "updation to $NEW_VERSION is completed successfully."
  exit 0
fi

write_state "update-failed"
log "updation to $NEW_VERSION failed."

CHANNEL_JSON="$(fetch_channel)" || fail "Could not fetch $CHANNEL_URL to roll back to $CURRENT_VERSION."
ROLLBACK_DOCKER_COMPOSE="$(json_get "$CHANNEL_JSON" "$CURRENT_VERSION" docker-compose)"
ROLLBACK_UPDATE_SCRIPT="$(json_get "$CHANNEL_JSON" "$CURRENT_VERSION" update-script)"

if [ -z "$ROLLBACK_DOCKER_COMPOSE" ] || [ -z "$ROLLBACK_UPDATE_SCRIPT" ]; then
  write_state "rollback-failed"
  fail "The channel has no docker-compose and update-script entry for $CURRENT_VERSION; cannot roll back."
fi

if ! download "$ROLLBACK_DOCKER_COMPOSE" "$DP_COMPOSE_FILE"; then
  write_state "rollback-failed"
  fail "Could not download $ROLLBACK_DOCKER_COMPOSE to $DP_COMPOSE_FILE"
fi
log "Saved the $CURRENT_VERSION compose file to $DP_COMPOSE_FILE"

if run_update_script "$ROLLBACK_UPDATE_SCRIPT" rollback; then
  write_state "rolled-back"
  log "roll back to $CURRENT_VERSION version is completed successfully."
  exit 1
fi

write_state "rollback-failed"
fail "roll back to $CURRENT_VERSION failed; manual intervention is required."
