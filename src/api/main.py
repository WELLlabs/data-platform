import logging
import sys

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from middleware.security import RequestLoggingMiddleware, SecurityHeadersMiddleware
from routers.auth import router as auth_router
from routers.dataset import router as dataset_router
from routers.organization import router as organization_router
from routers.upload import router as upload_router
from starlette.responses import JSONResponse

__version__ = "0.2.0"


def create_app() -> FastAPI:
    # Basic logging configuration if not already configured by the host
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            stream=sys.stdout,
        )

    app = FastAPI(
        title="WELL Labs Data Portal API",
        version=__version__,
        description="Open data portal API from WELL Labs",
        docs_url="/docs",
        redoc_url="/redoc",
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

    # Health route
    @app.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse({"status": "healthy", "version": __version__})

    # API routes
    app.include_router(
        auth_router, prefix="/auth", tags=["Authentication"], include_in_schema=False
    )
    app.include_router(
        organization_router, prefix="/organizations", tags=["Organizations"]
    )
    app.include_router(
        upload_router, prefix="", tags=["Upload"]
    )
    app.include_router(
        dataset_router, prefix="", tags=["Datasets"]
    )

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
