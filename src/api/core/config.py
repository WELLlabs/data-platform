from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    POSTGRES_URL: str
    REDIS_URL: str
    S3_HANDLER_URL: str
    S3_REGION: str
    S3_BUCKET: str
    COOKIE_NAME: str = "auth_cookie"
    COOKIE_MAX_AGE_SECONDS: int = 60 * 60 * 24  # 1 day

    class Config:
        env_file = ".env"
        extra = "ignore"  # ignores unexpected variables


settings = Settings()  # type: ignore[call-arg]
