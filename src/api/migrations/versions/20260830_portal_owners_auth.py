"""Drop users.student, add dataset_owners, nullable org, auth_provider.

Revision ID: 20260830_owners_auth
Revises:
Create Date: 2026-08-30

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260830_owners_auth"
down_revision: Union[str, Sequence[str], None] = "b5c5fa9ab19a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "student")
    op.add_column(
        "users",
        sa.Column(
            "auth_provider",
            sa.String(length=20),
            nullable=False,
            server_default="password",
        ),
    )
    op.alter_column("users", "organization", existing_type=sa.String(length=50), nullable=True)

    op.create_table(
        "dataset_owners",
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("added_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["datasets.dataset_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("dataset_id", "user_id"),
    )
    op.create_index(
        op.f("ix_dataset_owners_dataset_id"),
        "dataset_owners",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_dataset_owners_user_id"),
        "dataset_owners",
        ["user_id"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO dataset_owners (dataset_id, user_id, added_by, added_at)
        SELECT dataset_id, creator, creator, NOW()
        FROM datasets
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dataset_owners_user_id"), table_name="dataset_owners")
    op.drop_index(op.f("ix_dataset_owners_dataset_id"), table_name="dataset_owners")
    op.drop_table("dataset_owners")
    op.drop_column("users", "auth_provider")
    op.alter_column(
        "users", "organization", existing_type=sa.String(length=50), nullable=False
    )
    op.add_column(
        "users",
        sa.Column("student", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
