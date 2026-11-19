"""Record which admin approved a user's organisation signup.

Revision ID: 20261118_user_approved_by
Revises: 20261102_raster_georef

Existing users stay NULL. The approver is stored the next time an admin
approves a signup.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261118_user_approved_by"
down_revision: Union[str, Sequence[str], None] = "20261102_raster_georef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_approved_by_users",
        "users",
        "users",
        ["approved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_approved_by_users", "users", type_="foreignkey")
    op.drop_column("users", "approved_by")
