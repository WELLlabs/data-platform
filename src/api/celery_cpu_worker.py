"""Celery worker for CPU conversion (prefork, no gevent)."""

import logging
import sys
from pathlib import Path

# Prefork children do not keep cwd on sys.path; app packages live in /app.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.celery import celery_app
from tasks import cpu  # noqa: F401

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    celery_app.worker_main()


logger = logging.getLogger(__name__)

if __name__ == "__main__":
    celery_app.worker_main()
