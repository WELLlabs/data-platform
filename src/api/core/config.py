from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    POSTGRES_URL: str
    REDIS_URL: str
    S3_HANDLER_URL: str
    S3_REGION: str
    S3_BUCKET: str
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

    # Celery configuration
    CELERY_ACCEPT_CONTENT: List[str] = ["json"]
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
    # Organization list cache (Redis) TTL in seconds; default 604800 (7 days) if not set
    ORGANIZATION_LIST_CACHE_AGE_SECONDS: int = 604800
    # Dataset info cache (Redis) TTL in seconds; default 300 (5 minutes) if not set
    DATASET_INFO_CACHE_AGE_SECONDS: int = 300

    class Config:
        env_file = ".env"
        extra = "ignore"  # ignores unexpected variables


settings = Settings()  # type: ignore[call-arg]
