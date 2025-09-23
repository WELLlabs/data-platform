from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from src.api.routers.auth import router as auth_router


def create_app() -> FastAPI:
    app = FastAPI(title="WELL Labs API", version="0.1.0")

    # CORS: allow frontend origin(s) from env or default to localhost
    frontend_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=frontend_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Health route
    @app.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse({"status": "healthy"})

    # Routers
    app.include_router(auth_router, prefix="/auth", tags=["auth"])

    return app


app = create_app()

