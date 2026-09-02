"""Drop files.value.

Revision ID: 20260902_drop_value
Revises: 20260830_owners_auth
Create Date: 2026-09-02

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_drop_value"
down_revision: Union[str, Sequence[str], None] = "20260830_owners_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("files", "value")


def downgrade() -> None:
    op.add_column(
        "files",
        sa.Column("value", sa.String(length=10), nullable=True),
    )
