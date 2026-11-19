"""Record who uploaded each file.

Revision ID: 20261119_file_uploaded_by
Revises: 20261118_user_approved_by

Existing files are attributed to the dataset creator so a single-owner
dataset still has an uploader to show.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261119_file_uploaded_by"
down_revision: Union[str, Sequence[str], None] = "20261118_user_approved_by"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_files_uploaded_by_users",
        "files",
        "users",
        ["uploaded_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE files AS f
        SET uploaded_by = d.creator
        FROM datasets AS d
        WHERE f.dataset_id = d.dataset_id
          AND f.uploaded_by IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_files_uploaded_by_users", "files", type_="foreignkey")
    op.drop_column("files", "uploaded_by")
