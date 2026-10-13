# Open Data Portal — Setup

This guide covers cloning the repo, configuring environment, running the stack, applying database migrations, and indexing search. It is the setup companion to the feature docs in this folder.

| Topic | Document |
|--------|----------|
| Authentication | [auth.md](auth.md) |
| Dataset access | [access_control.md](access_control.md) |
| Uploads | [dataset_upload_job.md](dataset_upload_job.md) |
| Editing datasets | [edit_dataset.md](edit_dataset.md) |
| Search | [search.md](search.md) |

---

## 1. What you are running

The portal is a React frontend (`src/web`) and a FastAPI backend (`src/api`) with:

| Service | Role | Dev ports |
|---------|------|-----------|
| **frontend** | Nginx serving the built React app; proxies `/api/` to the backend | 80, 443 |
| **backend** | FastAPI API (`root_path=/api`) | 8000 |
| **db** | PostgreSQL 17 (dev compose only; prod uses an external database) | 5432 |
| **redis** | Sessions, caches, Celery broker | 6379 |
| **typesense** | Instant / fuzzy / semantic search | 8108 |
| **email-worker** | Celery worker for email | — |
| **titiler** | Cloud Optimized GeoTIFF tiles for raster preview | 8001 |

Uploads go to **S3** via API-generated presigned URLs. Search uses **Typesense** when `TYPESENSE_HOST` is set; otherwise PostgreSQL full-text search.

---

## 2. Prerequisites

- Git
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2
- An **S3 bucket** in a region you can write to (required even for local work)
- AWS access keys **or** an instance IAM role (production)

Optional for a hot-reload UI on port 3000 (typical local workflow):

- Node.js 22+ and npm
- The backend already published on `localhost:8000` (dev compose does this)

Python 3.13 and [uv](https://docs.astral.sh/uv/) are only needed if you run Alembic or API scripts **on the host**. Inside Docker they are already installed.

---

## 3. Clone and environment

```bash
git clone git@github.com:WELLlabs/open-data-portal.git
cd open-data-portal
cp env.template .env
```

The template file is `env.template` (not `.env.template`). Edit `.env` before the first `compose up`.

### Required values

| Variable | Notes |
|----------|--------|
| `DOMAIN` | Public origin, e.g. `https://data.welllabs.org` or `http://localhost:3000` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Dev database (dev compose) |
| `POSTGRES_URL` | Async SQLAlchemy URL. In Docker use host `db`: `postgresql+asyncpg://postgres:postgres@db:5432/postgres`. On the host (Alembic from your machine) use `localhost` instead of `db`. |
| `REDIS_URL` | e.g. `redis://redis/0` |
| `EMAIL_BROKER_URL`, `EMAIL_RESULT_BACKEND`, `UPLOAD_JOBS_BACKEND` | Separate Redis DBs (`/1`, `/2`, `/3` in the template) |
| `S3_REGION`, `S3_BUCKET` | Bucket the API will sign URLs for |
| `SECRET` | Session / token secret (generate a long random string) |
| `COOKIE_NAME` | Session cookie name |
| `COOKIE_MAX_AGE_SECONDS`, `LONG_TOKEN_AGE_SECONDS` | Session and token lifetimes |
| `EMAIL_GATEWAY_KEY`, `EMAIL_SENDER` | Transactional email (Brevo). Dummy values allow boot; real mail will fail until set. |

### Strongly recommended

| Variable | Notes |
|----------|--------|
| `TYPESENSE_HOST` | `typesense` on the Docker network. Leave **blank** to disable Typesense and use Postgres FTS only. |
| `TYPESENSE_API_KEY` | Must match the Typesense container `--api-key` (template: `xyz`) |
| `TYPESENSE_COLLECTION` | Dataset/file index (default `portal_search`) |
| `TYPESENSE_TAGS_COLLECTION` | Tag autocomplete index (default `tags`) |
| `HOST_NAME` | Branding line, e.g. `WELL LABS` |

### Optional

| Variable | Notes |
|----------|--------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Leave blank on EC2 if the instance role can access the bucket |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Enables “Sign in with Google” |
| `ALLOWED_EMAIL_DOMAIN` | Restricts signup to one or more domains (comma-separated) |
| Cache TTLs | See `env.template` (`SEARCH_CACHE_AGE_SECONDS`, dataset/homepage caches, etc.) |
| `TITILER_BASE_URL` | Browser-reachable TiTiler origin. Compose publishes TiTiler on port 8001 and Nginx/CRA proxy it at `/titiler`. Use `/titiler` so raster maps work from the UI. |

Never commit `.env`.

---

## 4. Local development (Docker)

From the **repository root**:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

This starts Postgres, Redis, Typesense, API, email worker, TiTiler, and the Nginx frontend.

Wait until the API is healthy:

```bash
docker compose -f docker-compose.dev.yml ps
curl -sS http://localhost:8000/health
```

Expected: `{"status":"healthy","version":"1.0.0"}`.

### Apply database migrations

Containers do **not** run Alembic on startup. After the database is up:

```bash
docker compose -f docker-compose.dev.yml exec backend uv run alembic upgrade head
```

To create a new revision later (from `src/api` inside the container or with host `uv`):

```bash
docker compose -f docker-compose.dev.yml exec backend uv run alembic revision --autogenerate -m "describe change"
docker compose -f docker-compose.dev.yml exec backend uv run alembic upgrade head
```

If you run Alembic on the host, point `POSTGRES_URL` at `localhost` while the `db` port `5432` is published, then restore `@db` for Compose.

### Search indexes

On API startup the backend creates empty Typesense collections when `TYPESENSE_HOST` is set. Fill them after you have data:

```bash
# Tags vocabulary → Typesense (Postgres is source of truth)
docker compose -f docker-compose.dev.yml exec backend uv run python -m scripts.load_tag_vocabulary

# Optional: seed Postgres tags from JSONL if the tags table is empty
docker compose -f docker-compose.dev.yml exec backend uv run python -m scripts.load_tag_vocabulary --from-jsonl

# Reindex all datasets into Typesense
docker compose -f docker-compose.dev.yml exec backend uv run python -m scripts.reindex_typesense
```

Tag file: `src/api/scripts/data/tags.jsonl`.

### First organization

Organizations use a UUID primary key. Create one in the UI (create-organization flow after sign-up) rather than inserting a string `id` of `well-labs`.

### Open the app

| Entry | URL |
|-------|-----|
| API health | http://localhost:8000/health |
| OpenAPI | http://localhost:8000/docs (also under `/api` when proxied) |
| Typesense | http://localhost:8108/health |
| Nginx frontend | http://localhost (dev image may redirect HTTP → HTTPS) |

The Docker frontend is a **built** React bundle. For live UI reload, use the next section.

---

## 5. Local UI on port 3000

Keep Compose running (at least `backend`, `db`, `redis`, `typesense`, `email-worker`). In another terminal:

```bash
cd src/web
npm install
npm start
```

Create React App serves http://localhost:3000 and `src/web/src/setupProxy.js` proxies `/api` to `http://localhost:8000` (override with `REACT_APP_API_TARGET`). CORS already allows `localhost:3000`.

```bash
cd src/web
npm test
```

---

## 6. Production

Production compose (`docker-compose.prod.yml`) does **not** include Postgres. Point `POSTGRES_URL` at your managed or host Postgres. Redis, Typesense, API, email worker, TiTiler, and Nginx are in the compose file. Nginx mounts Let’s Encrypt copies from the host. Nginx proxies `/titiler/` to the TiTiler service.

### S3 IAM (EC2)

1. Create a policy allowing `s3:ListBucket` / `GetBucketLocation` / multipart list on `arn:aws:s3:::your-bucket-name`, and object `Put` / `Get` / `Delete` / multipart on `arn:aws:s3:::your-bucket-name/*`.
2. Attach it to an EC2 instance role, **or** set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`.
3. Set `S3_BUCKET` and `S3_REGION` to match.

A fuller JSON policy is in the root [README.md](../README.md).

### TLS (example: `data.welllabs.org`)

1. Issue a certificate with Certbot (`certonly --standalone` or your usual challenge).
2. Copy `fullchain.pem` and `privkey.pem` to a Docker-readable path, e.g. `/home/ubuntu/.ssl-certs/data.welllabs.org/`.
3. Prod frontend mounts that directory read-only to `/etc/letsencrypt/live/data.welllabs.org`.
4. Install `copy-ssl-certs.sh` as a Certbot deploy hook so renewals copy files and reload Nginx:

```bash
sudo cp copy-ssl-certs.sh /etc/letsencrypt/renewal-hooks/deploy/
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/copy-ssl-certs.sh
```

Adjust paths and the domain in that script if they differ from `data.welllabs.org`.

### Start production

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend uv run alembic upgrade head
```

Then load tags / reindex Typesense the same way as in development, using `-f docker-compose.prod.yml`.

An Elastic IP on the instance keeps DNS stable when the VM is stopped and started.

---

## 7. Useful Compose commands

```bash
# Logs
docker compose -f docker-compose.dev.yml logs -f backend

# Restart API after .env changes
docker compose -f docker-compose.dev.yml up -d backend --force-recreate

# Stop
docker compose -f docker-compose.dev.yml down
```

Dev Postgres data lives in the `pg_data` volume; Typesense data in `typesense_data`. `down` without `-v` keeps both.

---

## 8. Layout

```
open-data-portal/
  env.template
  docker-compose.dev.yml
  docker-compose.prod.yml
  docs/                  # this file and feature docs
  src/api/               # FastAPI, Alembic, Celery, Typesense scripts
  src/web/               # React app, Nginx Dockerfiles
```

---

## 9. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Backend never healthy | `.env` missing required keys (`POSTGRES_URL`, `REDIS_URL`, `S3_BUCKET`, `SECRET`, email Redis URLs). `docker compose logs backend`. |
| Empty search / no tag suggest | `TYPESENSE_HOST` and `TYPESENSE_API_KEY`. Run `load_tag_vocabulary` and `reindex_typesense`. Confirm http://localhost:8108/health. |
| Alembic cannot connect | `POSTGRES_URL` host: `db` inside Compose, `localhost` from the host. |
| Uploads fail | Bucket name/region, IAM or access keys, CORS on the bucket if the browser PUTs directly to S3. |
| UI on :3000 cannot call API | Backend on 8000; CRA proxy; CORS origins include `http://localhost:3000`. |
| No email | `EMAIL_GATEWAY_KEY` / `EMAIL_SENDER`; `email-worker` logs. |
| HTTP frontend redirects forever | Dev/prod Nginx listens on 443 with certs; use https://localhost or the CRA app on :3000. |

---

## 10. After pull

```bash
git pull
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec backend uv run alembic upgrade head
```

Re-run Typesense scripts if search collections or tag vocabulary changed.
