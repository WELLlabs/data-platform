"""Load the WELL Labs tag vocabulary into a dedicated Typesense collection.

This creates a separate collection (default: "tag_vocabulary") that powers
tag autocomplete in two places: the dataset tagging form and the main search
box. It is independent of the dataset/file search collection that
services/typesense_index.py already manages, so it does not touch existing
search behaviour.

Place this file in:  src/api/scripts/load_tag_vocabulary.py
Place tags.jsonl in:  src/api/scripts/data/tags.jsonl   (or pass --file)

Run from src/api:
  uv run python -m scripts.load_tag_vocabulary
  uv run python -m scripts.load_tag_vocabulary --recreate      # drop and rebuild
  uv run python -m scripts.load_tag_vocabulary --file /path/to/tags.jsonl
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import httpx
from core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("load_tag_vocabulary")

# A dedicated collection just for the tag list. Kept separate from the
# dataset search collection (settings.TYPESENSE_COLLECTION) on purpose.
TAGS_COLLECTION = os.getenv("TYPESENSE_TAGS_COLLECTION", "tag_vocabulary")

TAGS_SCHEMA = {
    "name": TAGS_COLLECTION,
    "fields": [
        {"name": "id", "type": "string"},
        # "tag" is the slug (water-scarcity); "label" is the readable form
        # (water scarcity). Both are searchable so a user typing either the
        # hyphenated slug or plain words gets matches.
        {"name": "tag", "type": "string"},
        {"name": "label", "type": "string"},
        # theme lets you filter suggestions (e.g. only Water tags) and show
        # a facet count per theme.
        {"name": "theme", "type": "string", "facet": True},
    ],
}


def _base_url() -> str:
    proto = settings.TYPESENSE_PROTOCOL.strip() or "http"
    return f"{proto}://{settings.TYPESENSE_HOST.strip()}:{int(settings.TYPESENSE_PORT)}"


def _headers() -> dict[str, str]:
    return {"X-TYPESENSE-API-KEY": settings.TYPESENSE_API_KEY.strip()}


def _default_data_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "tags.jsonl"


def main() -> None:
    parser = argparse.ArgumentParser(description="Load tag vocabulary into Typesense")
    parser.add_argument(
        "--file",
        default=str(_default_data_path()),
        help="Path to tags.jsonl (one JSON object per line)",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop the existing tags collection before loading",
    )
    args = parser.parse_args()

    if not (settings.TYPESENSE_HOST.strip() and settings.TYPESENSE_API_KEY.strip()):
        raise SystemExit(
            "Typesense is not configured (TYPESENSE_HOST / TYPESENSE_API_KEY). "
            "Set them in .env before loading the tag vocabulary."
        )

    data_path = Path(args.file)
    if not data_path.exists():
        raise SystemExit(f"Data file not found: {data_path}")

    jsonl = data_path.read_text(encoding="utf-8").strip()
    line_count = sum(1 for line in jsonl.splitlines() if line.strip())

    with httpx.Client(timeout=60.0) as client:
        # Optionally drop the collection so a re-run starts clean.
        if args.recreate:
            resp = client.delete(
                f"{_base_url()}/collections/{TAGS_COLLECTION}", headers=_headers()
            )
            logger.info("Delete existing collection: %s", resp.status_code)

        # Create the collection if it does not already exist.
        get = client.get(
            f"{_base_url()}/collections/{TAGS_COLLECTION}", headers=_headers()
        )
        if get.status_code != 200:
            create = client.post(
                f"{_base_url()}/collections", headers=_headers(), json=TAGS_SCHEMA
            )
            if create.status_code not in (200, 201, 409):
                raise SystemExit(
                    f"Create collection failed: {create.status_code} {create.text}"
                )
            logger.info("Created collection '%s'", TAGS_COLLECTION)
        else:
            logger.info("Collection '%s' already exists", TAGS_COLLECTION)

        # Bulk import. action=upsert makes the load idempotent: re-running
        # updates existing tags instead of erroring on duplicates.
        logger.info("Importing %d tags...", line_count)
        resp = client.post(
            f"{_base_url()}/collections/{TAGS_COLLECTION}/documents/import",
            headers={**_headers(), "Content-Type": "text/plain"},
            params={"action": "upsert"},
            content=jsonl.encode("utf-8"),
        )
        if resp.status_code >= 400:
            raise SystemExit(f"Import failed: {resp.status_code} {resp.text}")

        # Each import line returns {"success": true} or an error; count failures.
        failures = [ln for ln in resp.text.splitlines() if '"success":true' not in ln]
        if failures:
            logger.warning("%d rows failed. First error: %s", len(failures), failures[0])
        else:
            logger.info("Imported %d tags into '%s' successfully", line_count, TAGS_COLLECTION)


if __name__ == "__main__":
    main()
