import json
import os
from pathlib import Path
from typing import Any, List

from dotenv import load_dotenv
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_CONFIG_FILE = Path(__file__).resolve()


def _env_candidates() -> list[Path]:
    paths: list[Path] = []
    seen: set[Path] = set()
    for n in range(0, 6):
        try:
            candidate = _CONFIG_FILE.parents[n] / ".env"
        except IndexError:
            break
        if candidate not in seen:
            seen.add(candidate)
            paths.append(candidate)
    cwd_env = Path.cwd() / ".env"
    if cwd_env not in seen:
        paths.append(cwd_env)
    return paths


def _load_dotenv_files() -> None:
    for path in _env_candidates():
        if path.is_file():
            load_dotenv(path, override=False)


_load_dotenv_files()
_REPO_ROOT_ENV = next((p for p in _env_candidates() if p.is_file()), Path(".env"))


def host_name_from_env() -> str:
    """Read display host name from process env (HOST_NAME, with HOTS_NAME typo fallback)."""
    for key in ("HOST_NAME", "HOTS_NAME"):
        val = os.environ.get(key)
        if val and str(val).strip():
            return str(val).strip().replace("\r", "")
    return ""


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
    HOST_NAME: str = Field(
        default="",
        description="Display host name used in product branding",
    )

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
    HOMEPAGE_STATS_CACHE_AGE_SECONDS: int = 300
    HOMEPAGE_STATS_RESULT_COUNT: int = 10

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
        cleaned = {
            k: v.replace("\r", "") if isinstance(v, str) else v
            for k, v in data.items()
        }
        if not str(cleaned.get("HOST_NAME") or "").strip():
            alt = cleaned.get("HOTS_NAME") or host_name_from_env()
            if alt:
                cleaned["HOST_NAME"] = alt
        return cleaned

    @model_validator(mode="after")
    def _fallback_s3_access_keys(self) -> "Settings":
        if not self.AWS_ACCESS_KEY_ID.strip() and self.S3_ACCESS_KEY_ID.strip():
            self.AWS_ACCESS_KEY_ID = self.S3_ACCESS_KEY_ID.strip()
        if not self.AWS_SECRET_ACCESS_KEY.strip() and self.S3_SECRET_ACCESS_KEY.strip():
            self.AWS_SECRET_ACCESS_KEY = self.S3_SECRET_ACCESS_KEY.strip()
        if not (self.HOST_NAME or "").strip():
            self.HOST_NAME = host_name_from_env()
        return self


settings = Settings()  # type: ignore[call-arg]
