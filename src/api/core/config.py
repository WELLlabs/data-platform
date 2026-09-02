import json
from pathlib import Path
from typing import Any, List

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root .env: src/api/core/config.py -> parent^4 = repository root (not src/)
_REPO_ROOT_ENV = Path(__file__).resolve().parent.parent.parent.parent / ".env"


def parse_celery_accept_content(raw: str) -> List[str]:
    """Parse CELERY_ACCEPT_CONTENT from .env (str) — tolerates CRLF and malformed `[json]`."""
    s = raw.replace("\r", "").strip()
    if s == "[json]":
        return ["json"]
    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
        return ["json"]
    except json.JSONDecodeError:
        return ["json"]


class Settings(BaseSettings):
    POSTGRES_URL: str
    REDIS_URL: str
    S3_REGION: str = "ap-south-1"
    S3_BUCKET: str
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_UPLOAD_MAX_SIZE: int = 53_687_091_200  # 50 GiB
    S3_UPLOAD_EXP_TIME_MINS: int = 1440  # 1 day
    S3_DOWNLOAD_EXP_TIME_MINS: int = 1440  # 1 day
    COOKIE_NAME: str = "auth_cookie"
    COOKIE_MAX_AGE_SECONDS: int = 60 * 60 * 24  # 1 day

    # Domain and secrets
    DOMAIN: str
    SECRET: str
    LONG_TOKEN_AGE_SECONDS: int

    # Email configuration
    EMAIL_BROKER_URL: str
    EMAIL_RESULT_BACKEND: str
    EMAIL_GATEWAY_KEY: str
    EMAIL_SENDER: str
    FORGOT_PASSWORD_TEMPLATE_ID: int
    VERIFY_EMAIL_TEMPLATE_ID: int
    UPLOAD_APPROVAL_TEMPLATE_ID: int
    UPLOAD_APPROVAL_RESPONSE_TEMPLATE_ID: int
    USER_APPROVAL_REQUEST_TEMPLATE_ID: int
    USER_APPROVAL_RESPONSE_TEMPLATE_ID: int
    DATASET_TRANSFER_TEMPLATE_ID: int

    # Google OAuth (button enabled only when client id and secret are set)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""
    ALLOWED_EMAIL_DOMAIN: str = ""

    # Upload jobs (dedicated Redis DB — not session REDIS_URL)
    UPLOAD_JOBS_BACKEND: str = Field(
        ...,
        validation_alias=AliasChoices("UPLOAD_JOBS_BACKEND", "UPLOAD_JOBS_BACKED"),
    )
    UPLOAD_JOB_CACHE_AGE_SECONDS: int = 86400

    # Celery configuration (str avoids pydantic-settings json.loads on List before validators)
    CELERY_ACCEPT_CONTENT: str = '["json"]'
    CELERY_TASK_SERIALIZER: str = "json"
    CELERY_RESULT_SERIALIZER: str = "json"
    CELERY_TIMEZONE: str = "UTC"
    CELERY_TASK_DEFAULT_QUEUE: str = "default"
    CELERY_WORKER_PREFETCH_MULTIPLIER: int = 1
    CELERY_TASK_ACKS_LATE: bool = True
    CELERY_TASK_SOFT_TIME_LIMIT: int = 300  # 5 minutes
    CELERY_TASK_TIME_LIMIT: int = 360  # 6 minutes
    CELERY_RESULT_BACKEND_EXPIRES: int = 86400
    CELERY_TASK_DEFAULT_RETRY_DELAY: int = 10
    CELERY_TASK_MAX_RETRIES: int = 3

    # Search cache (Redis) TTL in seconds; default 120 if not set
    SEARCH_CACHE_AGE_SECONDS: int = 120
    # Typesense (optional; empty host disables Typesense and uses Postgres FTS)
    TYPESENSE_HOST: str = ""
    TYPESENSE_PORT: int = 8108
    TYPESENSE_PROTOCOL: str = "http"
    TYPESENSE_API_KEY: str = ""
    TYPESENSE_COLLECTION: str = "portal_search"
    # Organization list cache (Redis) TTL in seconds; default 604800 (7 days) if not set
    ORGANIZATION_LIST_CACHE_AGE_SECONDS: int = 604800
    # Dataset info cache (Redis) TTL in seconds; default 300 (5 minutes) if not set
    DATASET_INFO_CACHE_AGE_SECONDS: int = 300
    # Homepage stats cache (Redis) TTL and top-N list sizes
    HOMEPAGE_STATS_CACHE_AGE_SECONDS: int = 86400
    HOMEPAGE_STATS_RESULT_COUNT: int = 5

    model_config = SettingsConfigDict(
        env_file=(
            str(_REPO_ROOT_ENV) if _REPO_ROOT_ENV.is_file() else ".env",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="before")
    @classmethod
    def _strip_cr_from_env_values(cls, data: Any) -> Any:
        """CRLF .env files can leave '\\r' on values (breaks bool parsing)."""
        if not isinstance(data, dict):
            return data
        return {
            k: v.replace("\r", "") if isinstance(v, str) else v
            for k, v in data.items()
        }

    @model_validator(mode="after")
    def _fallback_s3_access_keys(self) -> "Settings":
        if not self.AWS_ACCESS_KEY_ID.strip() and self.S3_ACCESS_KEY_ID.strip():
            self.AWS_ACCESS_KEY_ID = self.S3_ACCESS_KEY_ID.strip()
        if not self.AWS_SECRET_ACCESS_KEY.strip() and self.S3_SECRET_ACCESS_KEY.strip():
            self.AWS_SECRET_ACCESS_KEY = self.S3_SECRET_ACCESS_KEY.strip()
        return self


settings = Settings()  # type: ignore[call-arg]
