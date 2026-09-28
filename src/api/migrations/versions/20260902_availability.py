"""Replace datasets.private and global_search_index.private with availability int.

Revision ID: 20260902_availability
Revises: 20260902_drop_value
Create Date: 2026-09-02

0 = public, 1 = private, 2 = organization, 3 = admins, 4 = owners.
Existing private=true rows become 2 (organization) to preserve current access.

Production revision 0e06e0766b39 installed search-sync triggers whose functions
insert and update global_search_index.private. Those triggers are not created
by this chain. Drop them in this revision, after private has been copied to
availability and before the column is removed. 20260925_search_index installs
the replacements that write availability.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_availability"
down_revision: Union[str, Sequence[str], None] = "20260902_drop_value"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _drop_legacy_private_search_triggers() -> None:
    """Drop search triggers that still reference global_search_index.private.

    A database created only from b5c5fa9ab19a has no such triggers. Production
    at 2640bfb90f92 does. Look them up from the catalog so this does not assume
    a single trigger name and does not fail when they are already gone.
    """
    op.execute(
        """
        DO $drop_legacy_private_search_triggers$
        DECLARE
            r record;
        BEGIN
            FOR r IN
                SELECT tg.tgname AS trigger_name,
                       n.nspname AS schema_name,
                       c.relname AS table_name
                FROM pg_trigger tg
                JOIN pg_class c ON c.oid = tg.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_proc p ON p.oid = tg.tgfoid
                JOIN pg_language l ON l.oid = p.prolang
                WHERE NOT tg.tgisinternal
                  AND n.nspname = 'public'
                  AND l.lanname IN ('plpgsql', 'sql')
                  AND pg_get_functiondef(p.oid) ILIKE '%global_search_index%'
                  AND pg_get_functiondef(p.oid) ILIKE '%private%'
            LOOP
                EXECUTE format(
                    'DROP TRIGGER %I ON %I.%I',
                    r.trigger_name,
                    r.schema_name,
                    r.table_name
                );
            END LOOP;
        END
        $drop_legacy_private_search_triggers$;
        """
    )


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
    # Dataset rows are copied. Drop production search triggers before either
    # private column is removed; the next UPDATE datasets is in org_uuid.
    _drop_legacy_private_search_triggers()
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
