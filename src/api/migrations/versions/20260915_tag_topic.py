"""Add tags.topic for vocabulary themes and custom-tag default NA.

Revision ID: 20260915_tag_topic
Revises: 20260902_org_uuid_pk
Create Date: 2026-09-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260915_tag_topic"
down_revision: Union[str, Sequence[str], None] = "20260902_org_uuid"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE tags ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT 'NA' NOT NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_tags_topic ON tags (topic)")


def downgrade() -> None:
    op.drop_index("ix_tags_topic", table_name="tags")
    op.drop_column("tags", "topic")
