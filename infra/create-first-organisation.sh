#!/usr/bin/env bash
# Creates the first organisation on a fresh Data Platform database.
#
# Usage: ./infra/create-first-organisation.sh
#   ENV_FILE             .env to read (default: ./.env, then the repo root .env)
#   PSQL_IMAGE           image used when psql is not installed (default: postgres:18-alpine)
#   PSQL_DOCKER_NETWORK  Docker network for that container (default: host)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || ENV_FILE="$SCRIPT_DIR/../.env"
PSQL_IMAGE="${PSQL_IMAGE:-postgres:18-alpine}"
PSQL_DOCKER_NETWORK="${PSQL_DOCKER_NETWORK:-host}"

die() {
  echo "Error: $*" >&2
  exit 1
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

# Reads KEY from the .env file without sourcing it.
read_env_var() {
  local key="$1" line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  value="$(trim "${value//$'\r'/}")"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

# psql does not understand SQLAlchemy driver suffixes such as postgresql+asyncpg://.
normalize_url() {
  trim "$1" | sed -E 's#^postgres(ql)?\+[A-Za-z0-9_]+://#postgresql://#'
}

# Runs SQL read from stdin, so psql -v variables are interpolated.
run_psql() {
  if command -v psql >/dev/null 2>&1; then
    PGCONNECT_TIMEOUT=5 psql -d "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
  else
    docker run --rm -i --network "$PSQL_DOCKER_NETWORK" -e PGCONNECT_TIMEOUT=5 \
      "$PSQL_IMAGE" psql -d "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
  fi
}

query() {
  local sql="$1"
  shift
  run_psql "$@" <<<"$sql"
}

echo "The script will get the PostgreSQL details from the .env file and will guide you to create the initial organisation."
read -r -p "Enter y to continue: " answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

[ -f "$ENV_FILE" ] || die ".env file not found. Run this from the directory that holds .env, or set ENV_FILE."

if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || die "Neither psql nor docker is installed."
  echo "psql not found; using $PSQL_IMAGE through Docker."
fi

DB_URL="$(normalize_url "$(read_env_var POSTGRES_URL)")"
[ -n "$DB_URL" ] || echo "POSTGRES_URL is not set in $ENV_FILE."

until [ -n "$DB_URL" ] && error="$(query 'SELECT 1' 2>&1 >/dev/null)"; do
  [ -n "$DB_URL" ] && echo "Connection failed: ${error:-unknown error}" >&2
  read -r -p "POSTGRES_URL: " DB_URL
  DB_URL="$(normalize_url "$DB_URL")"
  [ -n "$DB_URL" ] || die "No POSTGRES_URL entered."
done
echo "Connected to PostgreSQL."

[ "$(query "SELECT to_regclass('public.organizations') IS NOT NULL")" = "t" ] \
  || die "The organizations table does not exist. Run the database migrations first."
[ "$(query 'SELECT count(*) FROM organizations')" = "0" ] \
  || die "The Database is already configured."

while :; do
  read -r -p "organisation name: " ORG_NAME
  ORG_NAME="$(trim "$ORG_NAME")"
  if [ -z "$ORG_NAME" ]; then
    echo "The organisation name cannot be empty."
  elif [ "${#ORG_NAME}" -gt 100 ]; then
    echo "The organisation name must be 100 characters or fewer."
  else
    break
  fi
done

ALLOWED_DOMAINS="$(read_env_var ALLOWED_EMAIL_DOMAIN)"

# Domains are split, cleaned and de-duplicated the same way as
# schemas/organization.py; an empty list is stored as NULL (any domain).
ORG_ID="$(query "
INSERT INTO organizations
  (id, name, private, allow_password, allow_google, created_at, allowed_email_domains)
SELECT
  gen_random_uuid(),
  :'org_name',
  true,
  true,
  true,
  now(),
  NULLIF(
    ARRAY(
      SELECT email_domain
      FROM (
        SELECT lower(ltrim(btrim(part), '@')) AS email_domain, min(ord) AS first_seen
        FROM regexp_split_to_table(:'domains', '[,;[:space:]]+') WITH ORDINALITY AS t(part, ord)
        GROUP BY 1
      ) cleaned
      WHERE email_domain <> ''
      ORDER BY first_seen
    ),
    '{}'
  )::varchar[]
WHERE NOT EXISTS (SELECT 1 FROM organizations)
RETURNING id;
" -v org_name="$ORG_NAME" -v domains="$ALLOWED_DOMAINS")"

[ -n "$ORG_ID" ] || die "The Database is already configured."

echo "Created organisation \"$ORG_NAME\" ($ORG_ID)."
echo "First Organisation successfully created, proceed with signing up."
