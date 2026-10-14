# linux/amd64: Typesense publishes an amd64 .deb, and the compose TiTiler image is pinned to that architecture.
# Static files from the web stage are architecture-independent, but the virtualenvs are not.

FROM --platform=linux/amd64 node:22.19.0-alpine3.21 AS web
WORKDIR /app
COPY src/web/package.json src/web/package-lock.json src/web/.npmrc ./
RUN npm install
COPY src/web/ ./
RUN npm run build

# One environment for the API, the email worker, and the conversion worker.
FROM --platform=linux/amd64 python:3.13-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY src/api/pyproject.toml src/api/uv.lock ./
RUN uv sync --frozen --no-dev --extra visualization

# Raster libraries stay out of the API environment.
FROM --platform=linux/amd64 python:3.13-slim AS titiler
RUN python -m venv /opt/titiler \
    && /opt/titiler/bin/pip install --no-cache-dir "titiler.application[server]==2.4.0"

FROM --platform=linux/amd64 python:3.13-slim

# apt must not start nginx, redis, or typesense during the build.
# appuser takes uid 1000 before packages add their own system users.
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d \
    && useradd -m -u 1000 appuser

RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx \
        redis-server \
        supervisor \
        curl \
        ca-certificates \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        gdal-bin \
    && curl -fsSL -o /tmp/typesense-server.deb \
        https://dl.typesense.org/releases/27.1/typesense-server-27.1-amd64.deb \
    && printf '#!/bin/sh\nexit 0\n' > /usr/sbin/systemctl \
    && chmod +x /usr/sbin/systemctl \
    && apt-get install -y /tmp/typesense-server.deb \
    && rm -f /tmp/typesense-server.deb /usr/sbin/systemctl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

RUN pip install --no-cache-dir uv

RUN mkdir -p /app /var/lib/typesense /var/lib/redis /var/log/supervisor /etc/data-platform/ssl \
    && chown -R appuser:appuser /app

WORKDIR /app

COPY --chown=appuser:appuser --from=api /app/.venv /app/.venv
COPY --chown=appuser:appuser \
    src/api/pyproject.toml \
    src/api/uv.lock \
    src/api/alembic.ini \
    src/api/__init__.py \
    src/api/main.py \
    src/api/celery_worker.py \
    src/api/celery_cpu_worker.py \
    ./
COPY --chown=appuser:appuser src/api/core/ ./core/
COPY --chown=appuser:appuser src/api/db/ ./db/
COPY --chown=appuser:appuser src/api/middleware/ ./middleware/
COPY --chown=appuser:appuser src/api/models/ ./models/
COPY --chown=appuser:appuser src/api/routers/ ./routers/
COPY --chown=appuser:appuser src/api/schemas/ ./schemas/
COPY --chown=appuser:appuser src/api/services/ ./services/
COPY --chown=appuser:appuser src/api/tasks/ ./tasks/
COPY --chown=appuser:appuser src/api/emails/ ./emails/
COPY --chown=appuser:appuser src/api/utils/ ./utils/
COPY --chown=appuser:appuser src/api/scripts/ ./scripts/
COPY --chown=appuser:appuser src/api/migrations/ ./migrations/

COPY --from=titiler /opt/titiler /opt/titiler
COPY --from=web /app/build /usr/share/nginx/html

COPY deploy/nginx.conf /etc/nginx/conf.d/data-platform.conf
COPY deploy/supervisord.conf /etc/data-platform/supervisord.conf
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && chmod -R a+rX /opt/titiler

ENV REDIS_URL=redis://127.0.0.1:6379/0 \
    UPLOAD_JOBS_BACKEND=redis://127.0.0.1:6379/3 \
    EMAIL_BROKER_URL=redis://127.0.0.1:6379/1 \
    EMAIL_RESULT_BACKEND=redis://127.0.0.1:6379/2 \
    TYPESENSE_HOST=127.0.0.1 \
    TYPESENSE_PORT=8108 \
    TYPESENSE_PROTOCOL=http \
    TITILER_BASE_URL=/titiler \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    UV_NO_SYNC=1

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
