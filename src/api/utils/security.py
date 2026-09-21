"""
Security utilities for the application
"""

import re
import secrets
import string
from typing import List, Optional

import bleach
from fastapi import Header
from models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

_DOMAIN_SPLIT = re.compile(r"[,;\s]+")


def parse_allowed_email_domains(allowed_domain: Optional[str]) -> List[str]:
    """Parse ALLOWED_EMAIL_DOMAIN as one or more domains (comma/semicolon/space)."""
    if not allowed_domain or not str(allowed_domain).strip():
        return []
    seen: set[str] = set()
    domains: List[str] = []
    for part in _DOMAIN_SPLIT.split(str(allowed_domain).strip()):
        cleaned = part.strip().lstrip("@").lower()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            domains.append(cleaned)
    return domains


def mask_apikey(apikey: Optional[str]) -> str:
    """Return a masked API key representation safe for logs."""
    if not apikey:
        return "none"
    stripped_apikey = apikey.strip()
    if not stripped_apikey:
        return "empty"
    if len(stripped_apikey) <= 4:
        return f"***{stripped_apikey}"
    return f"{'*' * (len(stripped_apikey) - 4)}{stripped_apikey[-4:]}"


def optional_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> Optional[str]:
    """Script auth: X-API-Key header only (never a query parameter)."""
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    return None


def email_matches_allowed_domain(email: str, allowed_domain: Optional[str]) -> bool:
    """If allowed domains are set, require the email's domain to match one of them."""
    allowed = parse_allowed_email_domains(allowed_domain)
    if not allowed:
        return True
    if not email or "@" not in email:
        return False
    domain = email.rsplit("@", 1)[-1].strip().lower()
    return domain in allowed


def is_profile_complete(user: User) -> bool:
    return bool(user.full_name and str(user.full_name).strip() and user.organization)


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
