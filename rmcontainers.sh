#!/usr/bin/env bash
if [ -x "$(command -v docker-compose)" ]; then
    docker-compose -f docker-compose.dev.yml down
else
    docker compose -f docker-compose.dev.yml down
fi
docker image rm data-platform-frontend
docker image rm data-platform-backend
docker image rm data-platform-migrate
docker image rm data-platform-email-worker
docker image rm data-platform-conversion-worker
docker image prune -f
docker volume prune -f