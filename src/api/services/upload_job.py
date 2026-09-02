"""
Upload job helpers: aggregate Redis job metadata and per-event statuses.
"""

import json
import logging
from typing import Any, Dict, List

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


async def get_job_status(job_id: str, redis: Redis) -> Dict[str, Any]:
    """
    Load job:{job_id}, job:{job_id}:events, and each job:{job_id}:event:{event_id}.

    Returns:
        Job dict with added "events" list of {event_id: status} dicts, or {"error": "..."}.
    """
    raw = await redis.get(f"job:{job_id}")
    if not raw:
        return {"error": "Job not found"}
    try:
        job = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Corrupt JSON for job:%s", job_id)
        return {"error": "Invalid job data"}
    events_raw = await redis.get(f"job:{job_id}:events")
    try:
        event_ids: List[str] = json.loads(events_raw or "[]")
    except json.JSONDecodeError:
        logger.warning("Invalid JSON for job:%s:events", job_id)
        event_ids = []
    events: List[Dict[str, Any]] = []
    for eid in event_ids:
        event_raw = await redis.get(f"job:{job_id}:event:{eid}")
        if event_raw:
            try:
                data = json.loads(event_raw)
                st = data.get("status")
                events.append({eid: st})
            except json.JSONDecodeError:
                events.append({eid: "unknown"})
        else:
            events.append({eid: "unknown"})
    job["events"] = events
    return job
