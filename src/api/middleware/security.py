"""
Security middleware for the FastAPI application
"""

import time

from fastapi import Request
from fastapi.middleware.base import BaseHTTPMiddleware
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response as StarletteResponse


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add security headers to all responses.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> StarletteResponse:
        response = await call_next(request)

        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'"

        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log requests for security monitoring.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> StarletteResponse:
        start_time = time.time()

        # Log request details
        print(f"Request: {request.method} {request.url}")
        print(f"Client: {request.client.host if request.client else 'unknown'}")

        response = await call_next(request)

        # Log response details
        process_time = time.time() - start_time
        print(f"Response: {response.status_code} - {process_time:.4f}s")

        return response
