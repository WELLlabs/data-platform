"""Use UUID primary keys for organizations (replace name slugs like well-labs).

Revision ID: 20260902_org_uuid
Revises: 20260902_availability
Create Date: 2026-09-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260902_org_uuid"
down_revision: Union[str, Sequence[str], None] = "20260902_availability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("id_uuid", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute("UPDATE organizations SET id_uuid = gen_random_uuid() WHERE id_uuid IS NULL")
    op.alter_column("organizations", "id_uuid", nullable=False)

    op.add_column(
        "datasets",
        sa.Column("organization_uuid", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE datasets d
        SET organization_uuid = o.id_uuid
        FROM organizations o
        WHERE d.organization = o.id
        """
    )

    op.add_column(
        "user_contributions",
        sa.Column("organization_id_uuid", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE user_contributions uc
        SET organization_id_uuid = o.id_uuid
        FROM organizations o
        WHERE uc.organization_id = o.id
        """
    )

    op.add_column(
        "global_search_index",
        sa.Column("organization_id_uuid", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE global_search_index g
        SET organization_id_uuid = o.id_uuid
        FROM organizations o
        WHERE g.organization_id = o.id
        """
    )

    op.add_column(
        "users",
        sa.Column("organization_uuid", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE users u
        SET organization_uuid = o.id_uuid
        FROM organizations o
        WHERE u.organization = o.id
        """
    )

    op.drop_constraint("datasets_organization_fkey", "datasets", type_="foreignkey")
    op.drop_constraint(
        "user_contributions_organization_id_fkey",
        "user_contributions",
        type_="foreignkey",
    )

    op.drop_constraint("organizations_pkey", "organizations", type_="primary")
    op.drop_column("organizations", "id")
    op.alter_column("organizations", "id_uuid", new_column_name="id")
    op.create_primary_key("organizations_pkey", "organizations", ["id"])

    op.drop_column("datasets", "organization")
    op.alter_column("datasets", "organization_uuid", new_column_name="organization")
    op.execute("DELETE FROM datasets WHERE organization IS NULL")
    op.alter_column("datasets", "organization", nullable=False)
    op.create_foreign_key(
        "datasets_organization_fkey",
        "datasets",
        "organizations",
        ["organization"],
        ["id"],
        ondelete="RESTRICT",
    )
    # Dropping the old string column also dropped ix_datasets_organization.
    op.create_index(
        "ix_datasets_organization",
        "datasets",
        ["organization"],
        unique=False,
    )

    op.drop_column("user_contributions", "organization_id")
    op.alter_column(
        "user_contributions", "organization_id_uuid", new_column_name="organization_id"
    )
    op.execute("DELETE FROM user_contributions WHERE organization_id IS NULL")
    op.alter_column("user_contributions", "organization_id", nullable=False)
    op.create_foreign_key(
        "user_contributions_organization_id_fkey",
        "user_contributions",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_index(
        "ix_global_search_index_organization_id",
        table_name="global_search_index",
    )
    op.drop_column("global_search_index", "organization_id")
    op.alter_column(
        "global_search_index",
        "organization_id_uuid",
        new_column_name="organization_id",
    )
    op.execute("DELETE FROM global_search_index WHERE organization_id IS NULL")
    op.alter_column("global_search_index", "organization_id", nullable=False)
    op.create_index(
        "ix_global_search_index_organization_id",
        "global_search_index",
        ["organization_id"],
        unique=False,
    )

    op.drop_column("users", "organization")
    op.alter_column("users", "organization_uuid", new_column_name="organization")
    op.create_foreign_key(
        "users_organization_fkey",
        "users",
        "organizations",
        ["organization"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_organization", "users", ["organization"], unique=False)


def downgrade() -> None:
    raise RuntimeError("Cannot downgrade organization UUID primary keys")
