"""
Celery worker entry point.

This module imports all Celery tasks to ensure they are registered with the Celery app.
It should be used as the entry point for running Celery workers.
"""

# IMPORTANT: monkey.patch_all() must be called BEFORE any other imports
# when using gevent pool (-P gevent)
from gevent import monkey

monkey.patch_all()

import logging

# Import Celery app to ensure configuration is loaded
from core.celery import celery_app

# Email worker only registers email tasks. CPU conversion runs in celery_cpu_worker.
from tasks import email  # noqa: F401

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    # Start Celery worker
    celery_app.worker_main()
