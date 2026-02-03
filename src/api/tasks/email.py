"""
Email tasks for sending transactional emails via Brevo (formerly Sendinblue).

This module contains Celery tasks for sending forgot password and email verification emails
using Brevo's transactional email API with template support.
"""

import logging
import threading
from collections.abc import Iterable
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from brevo_python.api.transactional_emails_api import TransactionalEmailsApi
from brevo_python.models.send_smtp_email import SendSmtpEmail
from brevo_python.models.send_smtp_email_to import SendSmtpEmailTo
from celery import signature
from core.celery import celery_app
from core.config import settings

logger = logging.getLogger(__name__)

# Module-level default sensitive parameters for URL sanitization
SENSITIVE_PARAMS = ["token", "reset_token", "verify_token"]

# Module-level cache for Brevo client with thread-safe lazy initialization
_brevo_client: TransactionalEmailsApi | None = None
_brevo_client_lock = threading.Lock()


def _sanitize_url(url: str, extra_sensitive: Iterable[str] | None = None) -> str:
    """
    Sanitize URL by masking sensitive token parameters in query string.

    Args:
        url: The URL to sanitize
        extra_sensitive: Optional iterable of additional sensitive parameter names
            to mask in addition to the default SENSITIVE_PARAMS

    Returns:
        Sanitized URL with token values masked as '***'
    """
    try:
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query, keep_blank_values=True)

        # Merge default sensitive params with any extra parameters
        sensitive_params = list(SENSITIVE_PARAMS)
        if extra_sensitive:
            sensitive_params.extend(extra_sensitive)

        # Mask sensitive parameters
        for param in sensitive_params:
            if param in query_params:
                query_params[param] = ["***"]

        # Reconstruct URL with masked parameters
        sanitized_query = urlencode(query_params, doseq=True)
        sanitized_parsed = parsed._replace(query=sanitized_query)
        return urlunparse(sanitized_parsed)
    except Exception:
        # If URL parsing fails, return a masked version
        logger.debug(
            "Failed to parse URL for sanitization: ***REDACTED_URL***", exc_info=True
        )
        try:
            parsed = urlparse(url)
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?token=***"
        except Exception:
            # If even basic parsing fails, return a generic masked URL
            logger.debug(
                "Failed to perform basic URL parsing: ***REDACTED_URL***", exc_info=True
            )
            return "***://***/***?token=***"


def _get_brevo_client() -> TransactionalEmailsApi:
    """
    Get configured Brevo API client with thread-safe lazy initialization.

    Validates EMAIL_GATEWAY_KEY up-front and caches a module-level client instance
    to avoid recreating ApiClient on every invocation.

    Returns:
        TransactionalEmailsApi instance configured with API key

    Raises:
        ValueError: If EMAIL_GATEWAY_KEY is missing or empty
    """
    # Up-front validation of API key
    if not settings.EMAIL_GATEWAY_KEY:
        raise ValueError(
            "EMAIL_GATEWAY_KEY is required but not configured. "
            "Please set EMAIL_GATEWAY_KEY in your environment variables."
        )

    # Thread-safe lazy initialization with double-checked locking pattern
    global _brevo_client
    if _brevo_client is None:
        with _brevo_client_lock:
            # Double-check after acquiring lock
            if _brevo_client is None:
                from brevo_python import ApiClient, Configuration

                configuration = Configuration()
                configuration.api_key["api-key"] = settings.EMAIL_GATEWAY_KEY
                api_client = ApiClient(configuration)
                _brevo_client = TransactionalEmailsApi(api_client)
                logger.debug("Initialized cached Brevo API client")

    return _brevo_client


@celery_app.task(
    name="email.send_forgot_password_email",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_forgot_password_email(
    self: Any, email: str, full_name: str, reset_link: str
) -> dict[str, Any]:
    """
    Send forgot password email via Brevo using template.

    Args:
        self: Celery task instance (for retry capability)
        email: Recipient email address
        full_name: User's full name
        reset_link: Complete reset link with token (format: $DOMAIN/reset-password?token={raw_token})

    Returns:
        Dictionary with success status and message ID

    Raises:
        Retry: If email sending fails and retries are available
    """
    try:
        logger.debug("Sending forgot password email")

        # Initialize Brevo client
        api_instance = _get_brevo_client()

        # Prepare email parameters for template
        params = {
            "full_name": full_name,
            "email": email,
            "reset_link": reset_link,
        }

        # Create email object
        send_smtp_email = SendSmtpEmail(
            to=[SendSmtpEmailTo(email=email, name=full_name)],
            template_id=settings.FORGOT_PASSWORD_TEMPLATE_ID,
            params=params,
            sender={"name": "WELL Labs Data Portal", "email": settings.EMAIL_SENDER},
        )

        # Send email
        api_response = api_instance.send_transac_email(send_smtp_email)
        message_id = api_response.message_id

        logger.info(
            "Successfully sent forgot password email to %s. Message ID: %s",
            email,
            message_id,
        )

        return {"status": "success", "message_id": message_id, "email": email}

    except Exception as exc:
        logger.exception(
            "Error sending forgot password email to %s: %s. Retry attempt: %s",
            email,
            exc,
            self.request.retries,
        )

        # Retry if we haven't exceeded max retries
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )

        # Max retries exceeded - route to dead letter queue
        # Check if we're already in the dead_letter queue to prevent re-routing
        current_queue = getattr(self.request, "delivery_info", {}).get("routing_key", "")
        if current_queue == "dead_letter":
            logger.error(
                "Max retries exceeded for forgot password email to %s in dead_letter queue. "
                "Task will be marked as failed permanently.",
                email,
            )
            raise

        logger.error(
            "Max retries exceeded for forgot password email to %s. "
            "Routing to dead_letter queue.",
            email,
        )

        # Route to dead letter queue
        try:
            signature(
                "email.send_forgot_password_email",
                args=[email, full_name, reset_link],
                kwargs={},
            ).apply_async(
                queue="dead_letter",
                retry=False,  # Don't retry in dead letter queue
            )
            logger.info(
                "Successfully routed failed forgot password email task to dead_letter queue for %s",
                email,
            )
        except Exception as routing_error:
            logger.exception(
                "Failed to route forgot password email task to dead_letter queue for %s: %s",
                email,
                routing_error,
            )

        # Re-raise to mark original task as failed
        raise


@celery_app.task(
    name="email.send_verify_email",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_verify_email(
    self: Any, email: str, full_name: str, verify_link: str
) -> dict[str, Any]:
    """
    Send email verification email via Brevo using template.

    Args:
        self: Celery task instance (for retry capability)
        email: Recipient email address
        full_name: User's full name
        verify_link: Complete verification link with token (format: $DOMAIN/verify-email?token={raw_token})

    Returns:
        Dictionary with success status and message ID

    Raises:
        Retry: If email sending fails and retries are available
    """
    try:
        logger.debug(
            "Sending verification email to %s with template ID %s",
            email,
            settings.VERIFY_EMAIL_TEMPLATE_ID,
        )

        # Initialize Brevo client
        api_instance = _get_brevo_client()

        # Prepare email parameters for template
        # Template requires params.full_name and params.verify_link
        params = {
            "full_name": full_name,
            "verify_link": verify_link,
        }

        logger.debug(
            "Sending verification email with params: full_name=%s, verify_link=%s",
            full_name,
            _sanitize_url(verify_link),
        )

        # Create email object
        send_smtp_email = SendSmtpEmail(
            to=[SendSmtpEmailTo(email=email, name=full_name)],
            template_id=settings.VERIFY_EMAIL_TEMPLATE_ID,
            params=params,
            sender={"name": "WELL Labs Data Portal", "email": settings.EMAIL_SENDER},
        )

        # Send email
        api_response = api_instance.send_transac_email(send_smtp_email)
        message_id = api_response.message_id

        logger.info(
            "Successfully sent verification email to %s. Message ID: %s",
            email,
            message_id,
        )

        return {"status": "success", "message_id": message_id, "email": email}

    except Exception as exc:
        logger.exception(
            "Error sending verification email to %s: %s. Retry attempt: %s",
            email,
            exc,
            self.request.retries,
        )

        # Retry if we haven't exceeded max retries
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )

        # Max retries exceeded - route to dead letter queue
        # Check if we're already in the dead_letter queue to prevent re-routing
        current_queue = getattr(self.request, "delivery_info", {}).get("routing_key", "")
        if current_queue == "dead_letter":
            logger.error(
                "Max retries exceeded for verification email to %s in dead_letter queue. "
                "Task will be marked as failed permanently.",
                email,
            )
            raise

        logger.error(
            "Max retries exceeded for verification email to %s. "
            "Routing to dead_letter queue.",
            email,
        )

        # Route to dead letter queue
        try:
            signature(
                "email.send_verify_email",
                args=[email, full_name, verify_link],
                kwargs={},
            ).apply_async(
                queue="dead_letter",
                retry=False,  # Don't retry in dead letter queue
            )
            logger.info(
                "Successfully routed failed verification email task to dead_letter queue for %s",
                email,
            )
        except Exception as routing_error:
            logger.exception(
                "Failed to route verification email task to dead_letter queue for %s: %s",
                email,
                routing_error,
            )

        # Re-raise to mark original task as failed
        raise
