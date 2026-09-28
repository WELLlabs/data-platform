"""Replace datasets.private and global_search_index.private with availability int.

Revision ID: 20260902_availability
Revises: 20260902_drop_value
Create Date: 2026-09-02

0 = public, 1 = private, 2 = organization, 3 = admins, 4 = owners.
Existing private=true rows become 2 (organization) to preserve current access.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_availability"
down_revision: Union[str, Sequence[str], None] = "20260902_drop_value"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column("availability", sa.Integer(), nullable=True),
    )
    op.execute(
        """
        UPDATE datasets
        SET availability = CASE WHEN private THEN 2 ELSE 0 END
        """
    )
    op.alter_column(
        "datasets",
        "availability",
        existing_type=sa.Integer(),
        nullable=False,
        server_default="0",
    )
    op.create_check_constraint(
        "ck_datasets_availability_range",
        "datasets",
        "availability >= 0 AND availability <= 4",
    )
    op.drop_column("datasets", "private")

    op.add_column(
        "global_search_index",
        sa.Column("availability", sa.Integer(), nullable=True),
    )
    op.execute(
        """
        UPDATE global_search_index
        SET availability = CASE WHEN private THEN 2 ELSE 0 END
        """
    )
    op.alter_column(
        "global_search_index",
        "availability",
        existing_type=sa.Integer(),
        nullable=False,
        server_default="0",
    )
    op.create_check_constraint(
        "ck_global_search_index_availability_range",
        "global_search_index",
        "availability >= 0 AND availability <= 4",
    )
    op.drop_column("global_search_index", "private")


def downgrade() -> None:
    op.add_column(
        "global_search_index",
        sa.Column("private", sa.Boolean(), nullable=True),
    )
    op.execute(
        """
        UPDATE global_search_index
        SET private = (availability <> 0)
        """
    )
    op.alter_column(
        "global_search_index",
        "private",
        existing_type=sa.Boolean(),
        nullable=False,
    )
    op.drop_constraint(
        "ck_global_search_index_availability_range",
        "global_search_index",
        type_="check",
    )
    op.drop_column("global_search_index", "availability")

    op.add_column(
        "datasets",
        sa.Column("private", sa.Boolean(), nullable=True),
    )
    op.execute(
        """
        UPDATE datasets
        SET private = (availability <> 0)
        """
    )
    op.alter_column(
        "datasets",
        "private",
        existing_type=sa.Boolean(),
        nullable=False,
    )
    op.drop_constraint(
        "ck_datasets_availability_range",
        "datasets",
        type_="check",
    )
    op.drop_column("datasets", "availability")
