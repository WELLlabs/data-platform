import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from middleware.security import RequestLoggingMiddleware, SecurityHeadersMiddleware
from routers.auth import router as auth_router
from starlette.responses import JSONResponse

__version__ = "0.1.0"


def create_app() -> FastAPI:
    app = FastAPI(
        title="WELL Labs Data Portal API",
        version=__version__,
        description="Secure data portal API with authentication and user management",
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

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
