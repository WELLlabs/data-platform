# Important Points
1. copy `.env.template` to `.env` and make necessary changes
2. place the SSL Certificate & Key file in the `src/web/nginx` directory as 
`ssl.crt` & `ssl.key`

# Docs
API structure of Authentication can be found at `./docs/auth.md`

# Alembic
```
uv add python-dotenv
uv add alembic psycopg2-binary asyncpg
```

run from the open-data-portal(root of project) directory
```
uv run --directory src/api alembic init migrations
uv run --directory src/api alembic revision --autogenerate -m "init schema" # enter custom message
uv run --directory src/api alembic upgrade head
```
