#!/bin/sh
set -e

if [ -z "${TYPESENSE_API_KEY}" ]; then
  echo "TYPESENSE_API_KEY is required" >&2
  exit 1
fi

mkdir -p /var/lib/typesense /var/lib/redis /var/log/supervisor /run

exec supervisord -n -c /etc/data-platform/supervisord.conf
