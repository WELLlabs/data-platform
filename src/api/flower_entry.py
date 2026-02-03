"""
Flower entry point without gevent monkey patching.

Flower uses Tornado, not gevent, so we need to import the Celery app
without applying gevent monkey patching.
"""

import logging

# Import Celery app to ensure configuration is loaded
from core.celery import celery_app

# Import all task modules to register them with Celery
# This ensures Celery can discover and execute all tasks
from tasks import (
    cpu,  # noqa: F401
    default,  # noqa: F401
    email,  # noqa: F401
)

# Expose celery_app as 'app' and 'celery' for Flower to find it
app = celery_app
celery = celery_app

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    # This file is only used for Flower, not for workers
    # Workers use celery_worker.py which has gevent monkey patching
    pass
