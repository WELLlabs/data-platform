"""
Security utilities for the application
"""

import secrets
import string
from typing import Optional

import bleach
from models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def generate_api_key(length: int = 32) -> str:
    """
    Generate a secure API key using cryptographically secure random generation.

    Args:
        length: Length of the API key (default: 32)

    Returns:
        A secure random API key string
    """
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_session_token() -> str:
    """
    Generate a cryptographically secure random session token (URL-safe base64).

    Used for session cookies; combine with a prefix in the caller if needed
    (e.g. token = f"session:{generate_session_token()}").

    Returns:
        A random token string suitable for use as a session identifier.
    """
    return secrets.token_urlsafe(32)


def sanitize_input(text: Optional[str]) -> Optional[str]:
    """
    Sanitize user input to prevent XSS attacks using bleach.

    Args:
        text: Input text to sanitize

    Returns:
        Sanitized text or None if input is None/empty
    """
    if not text:
        return None

    # Strip whitespace first
    stripped = text.strip()
    if not stripped:
        return None

    # Use bleach to clean HTML/script tags and prevent XSS
    sanitized = bleach.clean(stripped, tags=[], strip=True)

    return sanitized if sanitized else None


async def is_api_key_unique(session: AsyncSession, api_key: str) -> bool:
    """
    Check if an API key is unique in the database.

    Args:
        session: Database session
        api_key: API key to check

    Returns:
        True if unique, False if already exists
    """
    result = await session.execute(select(User).where(User.apikey == api_key))
    return result.scalar_one_or_none() is None


async def generate_unique_api_key(session: AsyncSession, max_attempts: int = 10) -> str:
    """
    Generate a unique API key for a user.

    Args:
        session: Database session
        max_attempts: Maximum attempts to generate unique key

    Returns:
        A unique API key

    Raises:
        RuntimeError: If unable to generate unique key after max attempts
    """
    for _ in range(max_attempts):
        api_key = generate_api_key()
        if await is_api_key_unique(session, api_key):
            return api_key

    raise RuntimeError("Unable to generate unique API key after maximum attempts")
