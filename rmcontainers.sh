docker compose -f docker-compose.dev.yml down
docker image rm data-app-frontend
docker image rm data-app-backend
docker image rm data-app-email-worker
docker image rm data-app-flower
docker image prune -f
docker volume prune -f