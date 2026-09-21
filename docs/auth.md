
# WELL Labs Data Portal — Authentication Reference

This document describes the authentication-related code in src/api/ and explains how the authentication flow, models, schemas, utilities, and middleware work together.

Files referenced (primary):

- `src/api/routers/auth.py` — HTTP endpoints and class-based controller
- `src/api/services/auth.py` — business logic: sign up, sign in, session handling, Redis strategy
- `src/api/models/user.py` — SQLAlchemy user model (extends fastapi-users base)
- `src/api/schemas/user.py` — Pydantic schemas for create/read/update
- `src/api/utils/security.py` — API key generation and input sanitization
- `src/api/middleware/security.py` — security headers and request logging middleware
- `src/api/core/config.py` — application settings (environment-driven)
- `src/api/db/session.py` — async database session factory

## High-level overview

The app uses FastAPI and an explicit, small authentication layer built on top of fastapi-users adapters and SQLAlchemy. Users are stored in Postgres via SQLAlchemy (async). Sessions are implemented using Redis as a simple token store. Passwords are hashed using fastapi-users' PasswordHelper. Each user gets a unique API key on creation.

Authentication endpoints are mounted under `/auth` in `main.py`.

## Configuration

Settings are defined in `src/api/core/config.py` (Pydantic BaseSettings):

- `POSTGRES_URL` — async SQLAlchemy DB URL (required)
- `REDIS_URL` — Redis connection URL (required)
- `SECRET` — application secret (required)
- `COOKIE_NAME` — cookie name used for session token (default: `auth_cookie`)
- `COOKIE_MAX_AGE_SECONDS` — session lifetime in seconds (default: 86400 — 1 day)

The app reads values from a `.env` file (see `Settings.Config.env_file`).

## Models and Schemas

Model: `src/api/models/user.py` — class `User` extends `SQLAlchemyBaseUserTableUUID` and adds fields:

- `full_name` (string, max 50, required)
- `designation` (optional string, max 25)
- `team` (optional string, max 25)
- `organization` (optional string, max 50; required after complete-profile)
- `auth_provider` (`password` or `google`)
- `role` (int, default 0)
- `bio` (optional text)
- `phone` (optional int)
- `created_at` (timezone-aware datetime, server default now)
- `verified` (bool)
- `apikey` (text, unique, required)
- `contributions` (int, default 0)

Schemas: `src/api/schemas/user.py`

- `UserCreate` — extends `fastapi_users.schemas.BaseUserCreate` and adds validation rules (min/max lengths, positive phone). Validators strip whitespace and reject empty required fields.
- `UserRead` — extends `fastapi_users.schemas.BaseUser` and exposes profile fields including `created_at`, `auth_provider`, and `profile_complete`. The per-user API key is **not** included; reveal it via session-only `GET /auth/apikey`.
- `UserUpdate` — partial fields for updates with similar validators.

Validation ensures required strings are non-empty after trimming and optional strings that are empty after trimming become `None`.

## Utilities (security)

File: `src/api/utils/security.py`

- `generate_api_key(length: int = 32)` — returns a cryptographically random string (letters + digits) of the requested length (default 32).
- `is_api_key_unique(session: AsyncSession, api_key: str)` — checks DB for existing API key using an async select on `User.apikey`.
- `generate_unique_api_key(session: AsyncSession, max_attempts: int = 10)` — attempts up to `max_attempts` times to produce a unique API key by calling `generate_api_key()` and checking uniqueness; raises `RuntimeError` if it cannot find a unique key.
- `sanitize_input(text: Optional[str])` — simple sanitizer to reduce XSS surface: trims input and removes characters/strings considered dangerous in the repo (examples: `<`, `>`, `"`, `'`, `&`, `;`, `(`, `)`, and literal substrings `script` and `javascript`); returns `None` for empty input.

Notes: `sanitize_input` is a coarse sanitizer intended to reduce obvious XSS vectors; it is used before saving or validating some string fields.

## Services — AuthService and RedisStrategy

Location: `src/api/services/auth.py`

AuthService responsibilities:

- User sign up (`sign_up`) — sanitize input fields, validate required strings, hash the password using `PasswordHelper.hash`, generate a unique API key (via `generate_unique_api_key`), and create the user using `SQLAlchemyUserDatabase.create`. Handles DB integrity errors and returns appropriate HTTP exceptions (conflict on email/apikey, bad request on validation, internal server error on unexpected failure).

- User sign in (`sign_in`) — fetch user by email via `user_db.get_by_email`, always perform password verification (to help avoid timing attacks), and if valid issue a Redis-backed session token. The token format in code is a simple string: `session:{user.id}`. The token is written to Redis with `setex` and the configured lifetime. `sign_in` returns a tuple `(user, cookie_dict)` where `cookie_dict` contains the parameters used by the controller to set an HTTP-only cookie.

- Convert model to schema (`user_to_user_read`) — maps a `User` model to `schemas.UserRead`.

- Forgot password (`forgot_password`) — placeholder that currently looks up the user by email but does not implement email delivery.

Dependencies and integration:

- `AuthService` is constructed via the `get_auth_service` dependency which wire in an instance of `SQLAlchemyUserDatabase` (built from the async SQLAlchemy session) and an async Redis instance from `get_redis()`.

RedisStrategy

- `write_token(token, user_id)` — writes `token -> user_id` with a TTL (`setex`).
- `read_token(token)` — reads the token and returns the stored user id as a string (or `None`). The helper decodes bytes if returned.
- `destroy_token(token)` — deletes the token from Redis.

Important: the token format used by the implementation is deterministic (`session:{user.id}`) — in production you'd normally use an unpredictable random token or signed JWT.

## Controllers and Routes

Router file: `src/api/routers/auth.py`

The code uses a class-based controller `AuthController(auth_service)` with endpoints wired to controller methods.

Routes included (mounted under `/auth` by `main.py`):

- POST `/auth/signin` — body: form fields `email` and `password`.
  - Sanitizes `email` with `sanitize_input`, rejects empty password.
  - Calls `AuthService.sign_in(email, password)` which returns `(user, cookie)`; controller sets the cookie if present using FastAPI's `response.set_cookie` and returns a `UserRead` JSON response.
  - Errors: 400 for invalid input, 401 for invalid credentials, 500 for service errors.

- POST `/auth/signup` — body: JSON following `UserCreate` schema.
  - Controller logs non-sensitive request fields, calls `AuthService.sign_up(user_data)` and returns `UserRead` (HTTP 201) on success.
  - Errors: 400 for validation, 409 for conflicts, 500 for other server errors.

- GET `/auth/me` — returns the current authenticated user's `UserRead` object.
  - Controller reads session token from request cookies (key from `settings.COOKIE_NAME`, default `auth_cookie`).
  - Uses `RedisStrategy.read_token` to translate token -> user_id, then `user_db.get(UUID(user_id))` to load the user model.
  - Errors: 401 if no cookie or invalid session or user not found, 500 on service error.

- POST `/auth/signout` — clears session cookie and removes token from Redis.
  - Controller pulls cookie from request, calls `RedisStrategy.destroy_token` and returns {"detail": "Successfully signed out"} and sets the cookie with an empty value and `max_age=0` to clear it.

- POST `/auth/forgotpassword` — accepts form field `email`.
  - Sanitizes email, calls `AuthService.forgot_password`. Currently the service is a noop placeholder; endpoint returns 200 with `{"detail": "Password reset request submitted"}` on success.

Response models: the router functions annotate response_model=UserRead for the signin, signup, and me endpoints. The actual JSON is produced using `jsonable_encoder(user_read.model_dump())` to ensure UUIDs and datetimes serialize correctly.

Cookie behavior

- Cookie name: `settings.COOKIE_NAME` (default `auth_cookie`).
- Cookie value: string token (example `session:{user.id}`).
- Cookie flags set in code: `httponly=True`, `samesite='lax'`, `max_age=settings.COOKIE_MAX_AGE_SECONDS`.
- `cookie_secure` is set to `False` inside `AuthService.cookie_transport` for local/dev use; in production this should be `True` and served over HTTPS.

## Middleware and security headers

`src/api/middleware/security.py` provides two middlewares added in `main.create_app()`:

- `SecurityHeadersMiddleware` — sets response headers:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy: default-src 'self'`

- `RequestLoggingMiddleware` — logs request start and response status with timing. Useful for auditing.

`main.create_app()` also configures `TrustedHostMiddleware` (allowed: `localhost`, `127.0.0.1`, `*.welllabs.org`) and `CORSMiddleware` with common localhost dev origins.

## Error handling and HTTP status codes

Key HTTP statuses used in the authentication flow:

- 200 OK — successful operations like sign in (returns user object), sign out confirmation, forgot password confirmation, and getting current user.
- 201 Created — successful sign up returning the created user.
- 400 Bad Request — invalid input (e.g., blank email after sanitization, required fields missing, validation errors).
- 401 Unauthorized — missing or invalid authentication token, invalid credentials.
- 409 Conflict — unique constraint violation (email already exists or API key conflict) on sign up.
- 500 Internal Server Error — unexpected server-side errors or exceptions in services.

The service layer maps SQLAlchemy IntegrityError and other exceptions to specific HTTPExceptions with detailed messages when appropriate.

## Security notes and recommendations (from code review)

- Session token format: the implementation uses a deterministic token string `session:{user.id}`. This is easy to understand but predictable. For production use prefer a cryptographically secure random token or a signed JWT.
- Cookie `secure` flag is currently `False` in `AuthService.cookie_transport` — set it to `True` in production and serve over HTTPS.
- `sanitize_input` removes common dangerous substrings and characters but is not a substitute for context-aware escaping (e.g., using templating engines with automatic escaping for HTML, or proper parameterized queries for DB — which are already used).
- Passwords are hashed via fastapi-users' PasswordHelper — ensure the library's recommended algorithms and parameters are up to date.
- Redis should be secured in production (password + network restrictions) and session tokens should be rotated/invalidated on password change.

## Examples

Sign up (JSON body, POST /auth/signup):

{
  "email": "alice@example.com",
  "password": "s3cretPassword!",
  "full_name": "Alice Example",
  "designation": "Researcher",
  "team": "Data",
  "organization": "WELL Labs",
  "role": 1,
  "bio": "Data scientist",
  "phone": 1234567890
}

Sign in (form data, POST /auth/signin):

- email: alice@example.com
- password: s3cretPassword!

Successful responses return the fields in `UserRead`, for example: `id`, `email`, `full_name`, `created_at`, `profile_complete`, plus flags like `is_active`, `is_verified`. Browser clients authenticate with the session cookie only. Scripts may send `X-API-Key`.

## Google sign-in

When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, `GET /auth/google` starts OAuth and `GET /auth/google/callback` creates or logs in the user. The first user on the instance becomes `is_superuser`. Google users have `auth_provider=google`, `is_verified=True`, and a nullable organization until they finish `GET`/`PUT /auth/complete-profile`. `ALLOWED_EMAIL_DOMAIN` (optional, comma-separated) applies to password signup and Google.

## Where to look next in the code

- Add email sending code to `AuthService.forgot_password` to implement full password reset flows.
- Consider replacing deterministic session tokens with random tokens and rotate or sign them.
- Improve `sanitize_input` to use an established escaping library when rendering HTML or storing rich text.

## Quick mapping: file -> responsibility

- `src/api/routers/auth.py` — HTTP surface and controller (validation, cookie management, route wiring)
- `src/api/services/auth.py` — core authentication business logic, password hashing, API key generation, Redis session strategy
- `src/api/utils/security.py` — helpers for API key generation and sanitization
- `src/api/models/user.py` — DB model and column definitions
- `src/api/schemas/user.py` — input/output validation and serialization
- `src/api/middleware/security.py` — response headers and request logging
- `src/api/core/config.py` — environment-driven settings
- `src/api/db/session.py` — async DB session factory
