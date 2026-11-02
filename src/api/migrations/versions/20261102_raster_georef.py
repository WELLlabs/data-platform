"""Record how each raster preview was georeferenced.

Revision ID: 20261102_raster_georef
Revises: 20261011_portal_updates

Existing raster rows get NULL and are re-checked the next time someone opens
the preview, so files previewed before this check pick up the fix.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261102_raster_georef"
down_revision: Union[str, Sequence[str], None] = "20261011_portal_updates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "converted_files",
        sa.Column("georef_status", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "converted_files",
        sa.Column("georef_note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("converted_files", "georef_note")
    op.drop_column("converted_files", "georef_status")
