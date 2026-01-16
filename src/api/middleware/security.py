"""
Security middleware for the FastAPI application
"""

import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response as StarletteResponse


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add security headers to all responses.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> StarletteResponse:
        response = await call_next(request)

        # Check if this is a Swagger UI or ReDoc request
        path = request.url.path
        is_docs_path = (
            path == "/docs"
            or path.startswith("/docs/")
            or path == "/redoc"
            or path.startswith("/redoc/")
            or path == "/openapi.json"
        )
        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Relax X-Frame-Options for Swagger UI (it may need iframes)
        if is_docs_path:
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
        else:
            response.headers["X-Frame-Options"] = "DENY"

        # X-XSS-Protection header is deprecated and removed
        # Modern browsers have built-in XSS protection, and CSP provides better protection
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Use permissive CSP for Swagger UI, restrictive for API endpoints
        if is_docs_path:
            # Very permissive CSP for Swagger UI to ensure it works
            # Swagger UI may load from various CDNs or be bundled
            response.headers["Content-Security-Policy"] = (
                "default-src 'self' https:; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
                "style-src 'self' 'unsafe-inline' https:; "
                "img-src 'self' data: https:; "
                "font-src 'self' data: https:; "
                "connect-src 'self' https:; "
                "frame-src 'self' https:; "
                "object-src 'none'; "
                "base-uri 'self'"
            )
        else:
            # Restrictive CSP for API endpoints with strong XSS protection
            # Replaces deprecated X-XSS-Protection header with modern CSP directives
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'none'; "
                "object-src 'none'; "
                "base-uri 'self'; "
                "form-action 'self'"
            )

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
