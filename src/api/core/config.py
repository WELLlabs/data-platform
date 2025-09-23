from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    POSTGRES_URL: str
    REDIS_URL: str
    SECRET: str
    COOKIE_NAME: str = "auth_cookie"
    COOKIE_MAX_AGE_SECONDS: int = 60 * 60 * 24  # 1 day

    class Config:
        env_file = ".env"


settings = Settings()  # type: ignore[call-arg]


