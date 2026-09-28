"""Index tags from Postgres into the Typesense tags collection.

Postgres is the source of truth. This does not insert or update tag rows.

Run in Docker:
  docker compose -f docker-compose.dev.yml exec backend uv run python -m scripts.load_tag_vocabulary

Optional: also upsert tags.jsonl into Postgres (only if the table is empty):
  uv run python -m scripts.load_tag_vocabulary --from-jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from db.session import SessionLocal
from models.tag import Tag
from services.typesense_index import (
    ensure_tags_collection,
    import_tag_documents,
    tag_document,
    typesense_enabled,
)
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("load_tag_vocabulary")


def _default_data_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "tags.jsonl"


def _stable_tag_id(slug: str):
    return uuid5(NAMESPACE_URL, f"open-data-portal:tag:{slug}")


async def index_postgres_tags() -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(Tag))
        all_tags = list(result.scalars().all())

    logger.info("Read %d tags from Postgres", len(all_tags))
    await ensure_tags_collection()
    if not typesense_enabled():
        logger.warning("Typesense is not configured; skipped tag collection import")
        return
    docs = [tag_document(t.tag_id, t.tag_name, t.topic) for t in all_tags]
    await import_tag_documents(docs)
    logger.info("Indexed %d tags into Typesense", len(docs))


async def upsert_from_jsonl(data_path: Path) -> None:
    records: list[dict] = []
    with data_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            slug = (rec.get("tag") or "").strip().lower()
            if not slug:
                continue
            topic = (rec.get("theme") or rec.get("topic") or "NA").strip() or "NA"
            records.append({"tag": slug, "topic": topic})

    logger.info("Loaded %d vocabulary rows from %s", len(records), data_path)

    async with SessionLocal() as session:
        result = await session.execute(select(Tag))
        existing = {t.tag_name.lower(): t for t in result.scalars().all()}
        created = 0
        skipped = 0
        for rec in records:
            slug = rec["tag"]
            tag = existing.get(slug)
            if tag:
                skipped += 1
                continue
            tag = Tag(
                tag_id=_stable_tag_id(slug),
                tag_name=slug,
                topic=rec["topic"],
            )
            session.add(tag)
            existing[slug] = tag
            created += 1
        await session.commit()
        logger.info(
            "Postgres tags from jsonl: created=%d skipped_existing=%d",
            created,
            skipped,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Index Postgres tags into Typesense (does not overwrite existing topics)"
    )
    parser.add_argument(
        "--from-jsonl",
        action="store_true",
        help="Insert missing tags from tags.jsonl; never updates existing topics",
    )
    parser.add_argument(
        "--file",
        default=str(_default_data_path()),
        help="Path to tags.jsonl (only used with --from-jsonl)",
    )
    args = parser.parse_args()

    async def run() -> None:
        if args.from_jsonl:
            data_path = Path(args.file)
            if not data_path.exists():
                raise SystemExit(f"Data file not found: {data_path}")
            await upsert_from_jsonl(data_path)
        await index_postgres_tags()

    asyncio.run(run())


if __name__ == "__main__":
    main()
