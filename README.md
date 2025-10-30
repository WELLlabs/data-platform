# Important Points
1. copy `.env.template` to `.env` and make necessary changes
2. place the SSL Certificate & Key file in the `src/web/nginx` directory as 
`ssl.crt` & `ssl.key`

# Docs
API structure of Authentication can be found at `./docs/auth.md`

# Alembic
run from the open-data-portal(root of project) directory,
if running in local environment with docker for postgres, change db in POSTGRES_URL to localhost and revert back after using alembic
```
uv run --directory src/api alembic init migrations
uv run --directory src/api alembic revision --autogenerate -m "init schema" # enter custom message
uv run --directory src/api alembic upgrade head
```

# Docker Compose
Before executing the docker compose, build the s3handler image.
```bash
docker build -t s3handler .
```

then run the docker compose
```bash
docker compose -f docker-compose.yml up -d --build
```
for development where database is a local instance, run
```bash
docker compose -f docker-compose.dev.yml up -d --build
```
