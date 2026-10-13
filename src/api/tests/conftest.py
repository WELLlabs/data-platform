"""Placeholder settings so unit tests can import the API without a deployment .env."""
import os

_DEFAULTS = {
    "POSTGRES_URL": "postgresql+asyncpg://user:pass@localhost:5432/portal",
    "REDIS_URL": "redis://localhost:6379/0",
    "S3_BUCKET": "test-bucket",
    "DOMAIN": "example.com",
    "SECRET": "test-secret",
    "LONG_TOKEN_AGE_SECONDS": "3600",
    "EMAIL_BROKER_URL": "redis://localhost:6379/1",
    "EMAIL_RESULT_BACKEND": "redis://localhost:6379/2",
    "EMAIL_GATEWAY_KEY": "test-key",
    "EMAIL_SENDER": "test@example.com",
    "UPLOAD_JOBS_BACKEND": "redis",
}
for key, value in _DEFAULTS.items():
    os.environ.setdefault(key, value)
