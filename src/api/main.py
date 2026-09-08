import logging
import os
import sys

import uvicorn
from core.config import host_name_from_env, settings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from middleware.security import RequestLoggingMiddleware, SecurityHeadersMiddleware
from routers.auth import router as auth_router
from routers.dataset import router as dataset_router
from routers.organization import router as organization_router
from routers.search import router as search_router
from routers.stats import router as stats_router
from routers.upload import router as upload_router
from routers.user import router as user_router
from starlette.responses import JSONResponse

__version__ = "1.0.0"


def _get_log_level() -> int:
    """
    Get logging level from LOG_LEVEL environment variable with safe default.

    Returns:
        int: Logging level (defaults to INFO if LOG_LEVEL is absent/invalid)
    """
    log_level_str = os.environ.get("LOG_LEVEL", "INFO").upper()
    # Map string to logging level
    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    # Return mapped level or default to INFO if invalid
    return level_map.get(log_level_str, logging.INFO)


def create_app() -> FastAPI:
    # Basic logging configuration if not already configured by the host
    if not logging.getLogger().handlers:
        log_level = _get_log_level()
        logging.basicConfig(
            level=log_level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            stream=sys.stdout,
        )

    app = FastAPI(
        title=f"Data Platform API by {host_name_from_env() or (settings.HOST_NAME or '').strip()}".strip(),
        version=__version__,
        description="Open data portal API",
        docs_url="/docs",
        redoc_url="/redoc",
        root_path="/api",
    )

    # Security middleware (order matters - first added is outermost)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    # Trusted host middleware for security
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["localhost", "127.0.0.1", "*.welllabs.org"],
    )

    # CORS: allow frontend origin(s) from env or default to localhost
    frontend_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
        "https://127.0.0.1:3000",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=frontend_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    @app.on_event("startup")
    async def _ensure_typesense() -> None:
        from services.typesense_index import ensure_collection

        await ensure_collection()

    # Health route
    @app.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse({"status": "healthy", "version": __version__})

    def _branding_payload() -> dict:
        host = host_name_from_env() or (settings.HOST_NAME or "").strip()
        return {
            "host_name": host,
            "product_name": "Data Platform",
            "brand_line": f"Data Platform by {host}" if host else "Data Platform",
        }

    # Served at /branding (nginx/CRA strip /api) and /api/branding (direct uvicorn + OpenAPI root_path).
    @app.get("/branding")
    @app.get("/api/branding")
    async def branding() -> JSONResponse:
        return JSONResponse(_branding_payload())

    # API routes
    app.include_router(
        auth_router, prefix="/auth", tags=["Authentication"], include_in_schema=False
    )
    app.include_router(
        organization_router, prefix="/organizations", tags=["Organizations"]
    )
    app.include_router(upload_router, prefix="", tags=["Files"])
    app.include_router(dataset_router, prefix="", tags=["Datasets"])
    app.include_router(search_router, prefix="", tags=["Search"])
    app.include_router(stats_router, prefix="")
    app.include_router(user_router, prefix="", tags=["Users"])

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
