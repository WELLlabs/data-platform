"""
Celery application configuration for async task processing.

This module sets up Celery with Redis as broker and result backend,
configures task queues, routing, and all settings from environment variables.
"""

import logging
from urllib.parse import urlparse, urlunparse
from kombu import Exchange, Queue

from celery import Celery
from core.config import parse_celery_accept_content, settings

logger = logging.getLogger(__name__)

# Initialize Celery app
celery_app = Celery(
    "data-welllabs-api",
    broker=settings.EMAIL_BROKER_URL,
    backend=settings.EMAIL_RESULT_BACKEND,
)

# Configure task queues
celery_app.conf.task_queues = (
    Queue("default", Exchange("default"), routing_key="default"),
    Queue("email", Exchange("email"), routing_key="email"),
    Queue("dead_letter", Exchange("dead_letter"), routing_key="dead_letter"),
    Queue("cpu", Exchange("cpu"), routing_key="cpu"),
)

# Task routing configuration
celery_app.conf.task_routes = {
    "email.*": {"queue": "email"},
    "cpu.*": {"queue": "cpu"},
}

# Apply Celery settings from environment variables
celery_app.conf.accept_content = parse_celery_accept_content(
    settings.CELERY_ACCEPT_CONTENT
)
celery_app.conf.task_serializer = settings.CELERY_TASK_SERIALIZER
celery_app.conf.result_serializer = settings.CELERY_RESULT_SERIALIZER
celery_app.conf.timezone = settings.CELERY_TIMEZONE
celery_app.conf.task_default_queue = settings.CELERY_TASK_DEFAULT_QUEUE
celery_app.conf.worker_prefetch_multiplier = settings.CELERY_WORKER_PREFETCH_MULTIPLIER
celery_app.conf.task_acks_late = settings.CELERY_TASK_ACKS_LATE
celery_app.conf.task_soft_time_limit = settings.CELERY_TASK_SOFT_TIME_LIMIT
celery_app.conf.task_time_limit = settings.CELERY_TASK_TIME_LIMIT
celery_app.conf.result_backend_expires = settings.CELERY_RESULT_BACKEND_EXPIRES
celery_app.conf.task_default_retry_delay = settings.CELERY_TASK_DEFAULT_RETRY_DELAY
celery_app.conf.task_max_retries = settings.CELERY_TASK_MAX_RETRIES

def _sanitize_url(url: str) -> str:
    """
    Sanitize URL by removing userinfo (username:password) from the URL.
    
    Args:
        url: URL string to sanitize
        
    Returns:
        Sanitized URL with userinfo removed
    """
    try:
        parsed = urlparse(url)
        # Check if hostname is present before building sanitized_netloc
        if not parsed.hostname:
            return "<URL parsing failed>"
        # Remove userinfo (username:password) from netloc
        sanitized_netloc = parsed.hostname
        if parsed.port:
            sanitized_netloc = f"{sanitized_netloc}:{parsed.port}"
        sanitized = parsed._replace(netloc=sanitized_netloc)
        return urlunparse(sanitized)
    except Exception:
        # If parsing fails, return a generic message
        return "<URL parsing failed>"


logger.info("Celery app configured with broker: %s", _sanitize_url(settings.EMAIL_BROKER_URL))
logger.info("Celery app configured with result backend: %s", _sanitize_url(settings.EMAIL_RESULT_BACKEND))
