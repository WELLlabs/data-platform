"""
Alembic migration for converted_files and file_access_log.

Revision ID: 20260921_converted_files
Revises: 20260915_tag_topic
Create Date: 2026-09-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260921_converted_files"
down_revision: Union[str, Sequence[str], None] = "20260915_tag_topic"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "converted_files",
        sa.Column("cloud_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("file_key", sa.Text(), nullable=False),
        sa.Column("format", sa.String(length=50), nullable=False),
        sa.Column(
            "created_on",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_accessed", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="processing",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["native_file_id"], ["files.file_id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("cloud_file_id"),
    )
    op.create_index(
        op.f("ix_converted_files_cloud_file_id"),
        "converted_files",
        ["cloud_file_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_converted_files_native_file_id"),
        "converted_files",
        ["native_file_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_converted_files_status"),
        "converted_files",
        ["status"],
        unique=False,
    )

    op.create_table(
        "file_access_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cloud_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("native_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "accessed_time",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["cloud_file_id"],
            ["converted_files.cloud_file_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["native_file_id"], ["files.file_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_file_access_log_id"), "file_access_log", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_file_access_log_cloud_file_id"),
        "file_access_log",
        ["cloud_file_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_file_access_log_native_file_id"),
        "file_access_log",
        ["native_file_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_file_access_log_user_id"),
        "file_access_log",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_file_access_log_user_id"), table_name="file_access_log")
    op.drop_index(
        op.f("ix_file_access_log_native_file_id"), table_name="file_access_log"
    )
    op.drop_index(
        op.f("ix_file_access_log_cloud_file_id"), table_name="file_access_log"
    )
    op.drop_index(op.f("ix_file_access_log_id"), table_name="file_access_log")
    op.drop_table("file_access_log")
    op.drop_index(op.f("ix_converted_files_status"), table_name="converted_files")
    op.drop_index(
        op.f("ix_converted_files_native_file_id"), table_name="converted_files"
    )
    op.drop_index(
        op.f("ix_converted_files_cloud_file_id"), table_name="converted_files"
    )
    op.drop_table("converted_files")
