"""Reindex all datasets into Typesense.

Run from src/api:
  uv run python -m scripts.reindex_typesense
"""

import asyncio
import logging

from db.session import SessionLocal
from models.dataset import Dataset
from services.typesense_index import ensure_collection, index_dataset
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reindex_typesense")


async def main() -> None:
    await ensure_collection()
    async with SessionLocal() as session:
        result = await session.execute(select(Dataset.dataset_id))
        ids = [row[0] for row in result.all()]
        logger.info("Indexing %d datasets", len(ids))
        for dataset_id in ids:
            await index_dataset(session, dataset_id)
        logger.info("Done")


if __name__ == "__main__":
    asyncio.run(main())
