"""
Email tasks for sending transactional emails via Brevo (formerly Sendinblue).

Bodies are rendered from HTML files in ``src/api/emails`` and sent as
``html_content``. Brevo dashboard template IDs are not used.
"""

import logging
import re
import threading
from collections.abc import Iterable
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from brevo_python.api.transactional_emails_api import TransactionalEmailsApi
from brevo_python.models.send_smtp_email import SendSmtpEmail
from brevo_python.models.send_smtp_email_to import SendSmtpEmailTo
from celery import signature
from core.celery import celery_app
from core.config import host_name_from_env, settings
from emails.render import render_email

logger = logging.getLogger(__name__)


def _sender_name() -> str:
    host = host_name_from_env() or (settings.HOST_NAME or "").strip()
    return f"Data Platform by {host}" if host else "Data Platform"


def _recipient_display_name_for_email(addr: str, display_name: str) -> str:
    """Use template name when provided; otherwise humanize the email local-part."""
    if display_name and str(display_name).strip():
        return str(display_name).strip()
    local = addr.split("@")[0] if "@" in addr else addr
    parts = [p.capitalize() for p in re.split(r"[._-]+", local) if p]
    return " ".join(parts) if parts else local


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
            "Failed to parse URL for sanitization: ***REDACTED_URL***",
            exc_info=True,
        )
        try:
            parsed = urlparse(url)
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?token=***"
        except Exception:
            # If even basic parsing fails, return a generic masked URL
            logger.debug(
                "Failed to perform basic URL parsing: ***REDACTED_URL***",
                exc_info=True,
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


def _render_email(template_name: str, *, email_title: str, **context: Any) -> str:
    """Render an HTML email from ``src/api/emails/{template_name}``."""
    return render_email(
        template_name,
        email_title=email_title,
        sender_name=_sender_name(),
        host_name=host_name_from_env() or (settings.HOST_NAME or "").strip(),
        **context,
    )


def _send_html_email(
    *,
    to_email: str,
    to_name: str,
    subject: str,
    html: str,
) -> Any:
    """Send a transactional email with inline HTML via Brevo."""
    api_instance = _get_brevo_client()
    send_smtp_email = SendSmtpEmail(
        to=[SendSmtpEmailTo(email=to_email, name=to_name)],
        sender={"name": _sender_name(), "email": settings.EMAIL_SENDER},
        subject=subject,
        html_content=html,
    )
    return api_instance.send_transac_email(send_smtp_email)


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
    Send forgot password email with the local HTML template.

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
        html = _render_email(
            "forgot_password.html",
            email_title="Reset your password",
            full_name=full_name,
            email=email,
            reset_link=reset_link,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=full_name,
            subject="Reset your password",
            html=html,
        )
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
    Send email verification with the local HTML template.

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
        logger.debug("Sending verification email to %s", email)
        logger.debug(
            "Sending verification email with params: full_name=%s, verify_link=%s",
            full_name,
            _sanitize_url(verify_link),
        )
        html = _render_email(
            "verify_email.html",
            email_title="Verify your email",
            full_name=full_name,
            verify_link=verify_link,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=full_name,
            subject="Verify your email",
            html=html,
        )
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


@celery_app.task(
    name="email.send_upload_approval",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_upload_approval(
    self: Any, email: str, title: str, name: str
) -> dict[str, Any]:
    """
    Send upload-approval notification (HTML: title + name).

    Args:
        email: Recipient address
        title: Dataset title
        name: Display name (e.g. uploader full_name from job meta)
    """
    try:
        logger.debug("Sending upload approval email to %s", email)
        html = _render_email(
            "upload_approval.html",
            email_title="Dataset waiting for review",
            title=title,
            name=name,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=_recipient_display_name_for_email(email, name),
            subject="A dataset is waiting for your review",
            html=html,
        )
        message_id = api_response.message_id
        logger.info(
            "Upload approval email sent to %s message_id=%s", email, message_id
        )
        return {"status": "success", "message_id": message_id, "email": email}
    except Exception as exc:
        logger.exception(
            "Error sending upload approval to %s: %s retries=%s",
            email,
            exc,
            self.request.retries,
        )
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )
        raise


@celery_app.task(
    name="email.send_upload_approval_response",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_upload_approval_response(
    self: Any, email: str, title: str, name: str
) -> dict[str, Any]:
    """
    Send upload-approval response notification (HTML: title + name).

    Args:
        email: Recipient address
        title: Dataset title
        name: Approver full name
    """
    try:
        logger.debug("Sending upload approval response email to %s", email)
        html = _render_email(
            "upload_approval_response.html",
            email_title="Your dataset has been approved",
            title=title,
            name=name,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=_recipient_display_name_for_email(email, ""),
            subject="Your dataset has been approved",
            html=html,
        )
        message_id = api_response.message_id
        logger.info(
            "Upload approval response email sent to %s message_id=%s",
            email,
            message_id,
        )
        return {"status": "success", "message_id": message_id, "email": email}
    except Exception as exc:
        logger.exception(
            "Error sending upload approval response to %s: %s retries=%s",
            email,
            exc,
            self.request.retries,
        )
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )
        raise


@celery_app.task(
    name="email.send_user_approval_response",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_user_approval_response(
    self: Any, email: str, action: str, name: str, message: str
) -> dict[str, Any]:
    """
    Send user approval/rejection notification (HTML: action, name, message).

    Args:
        email: Recipient address
        action: e.g. accepted / rejected
        name: Approver display name
        message: Body copy
    """
    try:
        logger.debug(
            "Sending user approval response email to %s action=%s",
            email,
            action,
        )
        html = _render_email(
            "user_approval_response.html",
            email_title=f"Your account was {action}",
            action=action,
            name=name,
            message=message,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=_recipient_display_name_for_email(email, ""),
            subject=f"Your account was {action}",
            html=html,
        )
        message_id = api_response.message_id
        logger.info(
            "User approval response email sent to %s message_id=%s action=%s",
            email,
            message_id,
            action,
        )
        return {"status": "success", "message_id": message_id, "email": email}
    except Exception as exc:
        logger.exception(
            "Error sending user approval response to %s: %s retries=%s",
            email,
            exc,
            self.request.retries,
        )
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )
        raise


@celery_app.task(
    name="email.send_user_approval_request",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_user_approval_request(self: Any, email: str, name: str) -> dict[str, Any]:
    """
    Send user approval request notification to organization admins.

    Args:
        email: Recipient admin email address
        name: New signup user full name
    """
    try:
        logger.debug(
            "Sending user approval request email to %s name=%s",
            email,
            name,
        )
        html = _render_email(
            "user_approval_request.html",
            email_title="A new user needs approval",
            name=name,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=_recipient_display_name_for_email(email, ""),
            subject="A new user needs approval",
            html=html,
        )
        message_id = api_response.message_id
        logger.info(
            "User approval request email sent to %s message_id=%s",
            email,
            message_id,
        )
        return {"status": "success", "message_id": message_id, "email": email}
    except Exception as exc:
        logger.exception(
            "Error sending user approval request to %s: %s retries=%s",
            email,
            exc,
            self.request.retries,
        )
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )
        raise


@celery_app.task(
    name="email.send_dataset_transfer",
    bind=True,
    max_retries=None,
    default_retry_delay=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
)
def send_dataset_transfer(
    self: Any, email: str, title: str, new_creator: str, admin_name: str
) -> dict[str, Any]:
    """
    Notify a user that they were added as a dataset owner.

    Args:
        email: Recipient address
        title: Dataset title
        new_creator: New creator display name
        admin_name: Admin who performed the transfer
    """
    try:
        logger.debug("Sending dataset transfer email to %s", email)
        html = _render_email(
            "dataset_transfer.html",
            email_title="You were added as a dataset owner",
            title=title,
            new_creator=new_creator,
            admin_name=admin_name,
        )
        api_response = _send_html_email(
            to_email=email,
            to_name=_recipient_display_name_for_email(email, new_creator),
            subject="You were added as a dataset owner",
            html=html,
        )
        message_id = api_response.message_id
        logger.info(
            "Dataset transfer email sent to %s message_id=%s", email, message_id
        )
        return {"status": "success", "message_id": message_id, "email": email}
    except Exception as exc:
        logger.exception(
            "Error sending dataset transfer to %s: %s retries=%s",
            email,
            exc,
            self.request.retries,
        )
        if self.request.retries < settings.CELERY_TASK_MAX_RETRIES:
            raise self.retry(
                exc=exc,
                countdown=settings.CELERY_TASK_DEFAULT_RETRY_DELAY,
                max_retries=settings.CELERY_TASK_MAX_RETRIES,
            )
        raise
