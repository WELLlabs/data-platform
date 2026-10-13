"""Date-only coverage, drop phone, and optional organisation auth settings.

Existing temporal values keep their UTC calendar day. Dropping users.phone
discards stored numbers; downgrade recreates an empty column.
Organisation flags default to allowing both password and Google sign-up.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261011_portal_updates"
down_revision: Union[str, Sequence[str], None] = "20260925_search_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _to_date(table: str, column: str) -> None:
    op.execute(
        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE date "
        f"USING ({column} AT TIME ZONE 'UTC')::date"
    )


def _to_timestamptz(table: str, column: str) -> None:
    op.execute(
        f"ALTER TABLE {table} ALTER COLUMN {column} TYPE timestamp with time zone "
        f"USING {column}::timestamp with time zone"
    )


def upgrade() -> None:
    for table in ("global_search_index", "files"):
        _to_date(table, "temporal_from")
        _to_date(table, "temporal_to")
    op.drop_column("users", "phone")
    op.add_column(
        "organizations",
        sa.Column("allowed_email_domains", postgresql.ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "allow_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "allow_google",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "allow_google")
    op.drop_column("organizations", "allow_password")
    op.drop_column("organizations", "allowed_email_domains")
    op.add_column("users", sa.Column("phone", sa.String(length=20), nullable=True))
    for table in ("files", "global_search_index"):
        _to_timestamptz(table, "temporal_to")
        _to_timestamptz(table, "temporal_from")
