"""Search index for a fresh database: trigram extension, uniqueness, and sync triggers.

Revision ID: 20260925_search_index
Revises: 20260921_converted_files
Create Date: 2026-09-25

global_search_index is filled by triggers on datasets, files, and tag_dataset.
PostgreSQL search uses pg_trgm (`title % query` and similarity()).
The organization UUID migration dropped ix_datasets_organization with the old
column; create it here when this revision runs on a database that already
passed that migration.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260925_search_index"
down_revision: Union[str, Sequence[str], None] = "20260921_converted_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_datasets_organization "
        "ON datasets (organization)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_global_search_index_dataset_file
        ON global_search_index (dataset_id, file_id) NULLS NOT DISTINCT
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_global_search_index_fts_vector
        ON global_search_index USING GIN (fts_vector)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_global_search_index_title_trgm
        ON global_search_index USING GIN (title gin_trgm_ops)
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION refresh_global_search_dataset(p_dataset_id uuid)
        RETURNS void
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_title text;
            v_description text;
            v_org uuid;
            v_availability integer;
            v_tags text;
            v_ctx text;
        BEGIN
            SELECT dataset_title, dataset_description, organization, availability
            INTO v_title, v_description, v_org, v_availability
            FROM datasets
            WHERE dataset_id = p_dataset_id;

            IF NOT FOUND THEN
                DELETE FROM global_search_index WHERE dataset_id = p_dataset_id;
                RETURN;
            END IF;

            SELECT string_agg(t.tag_name, ', ' ORDER BY t.tag_name)
            INTO v_tags
            FROM tag_dataset td
            JOIN tags t ON t.tag_id = td.tag_id
            WHERE td.dataset_id = p_dataset_id;

            v_ctx := concat_ws(
                ', ',
                NULLIF(btrim(v_description), ''),
                NULLIF(v_tags, '')
            );

            INSERT INTO global_search_index (
                dataset_id, file_id, title, context, fts_vector,
                organization_id, availability, temporal_from, temporal_to
            ) VALUES (
                p_dataset_id,
                NULL,
                v_title,
                NULLIF(v_ctx, ''),
                to_tsvector('english', concat_ws(' ', v_title, v_ctx)),
                v_org,
                v_availability,
                NULL,
                NULL
            )
            ON CONFLICT (dataset_id, file_id) DO UPDATE SET
                title = EXCLUDED.title,
                context = EXCLUDED.context,
                fts_vector = EXCLUDED.fts_vector,
                organization_id = EXCLUDED.organization_id,
                availability = EXCLUDED.availability;

            UPDATE global_search_index
            SET organization_id = v_org,
                availability = v_availability
            WHERE dataset_id = p_dataset_id
              AND file_id IS NOT NULL;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION refresh_global_search_file(p_file_id uuid)
        RETURNS void
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_file files%ROWTYPE;
            v_org uuid;
            v_availability integer;
            v_ctx text;
        BEGIN
            SELECT * INTO v_file FROM files WHERE file_id = p_file_id;
            IF NOT FOUND THEN
                DELETE FROM global_search_index WHERE file_id = p_file_id;
                RETURN;
            END IF;

            SELECT organization, availability
            INTO v_org, v_availability
            FROM datasets
            WHERE dataset_id = v_file.dataset_id;

            v_ctx := concat_ws(
                ' ',
                NULLIF(btrim(v_file.file_description), ''),
                NULLIF(btrim(v_file.file_format), ''),
                NULLIF(btrim(v_file.provenance), ''),
                NULLIF(btrim(v_file.source), ''),
                NULLIF(btrim(v_file.geography), '')
            );

            INSERT INTO global_search_index (
                dataset_id, file_id, title, context, fts_vector,
                organization_id, availability, temporal_from, temporal_to
            ) VALUES (
                v_file.dataset_id,
                v_file.file_id,
                v_file.file_title,
                NULLIF(v_ctx, ''),
                to_tsvector('english', concat_ws(' ', v_file.file_title, v_ctx)),
                v_org,
                COALESCE(v_availability, 0),
                v_file.temporal_from,
                v_file.temporal_to
            )
            ON CONFLICT (dataset_id, file_id) DO UPDATE SET
                title = EXCLUDED.title,
                context = EXCLUDED.context,
                fts_vector = EXCLUDED.fts_vector,
                organization_id = EXCLUDED.organization_id,
                availability = EXCLUDED.availability,
                temporal_from = EXCLUDED.temporal_from,
                temporal_to = EXCLUDED.temporal_to;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION sync_global_search_index_from_datasets()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                DELETE FROM global_search_index WHERE dataset_id = OLD.dataset_id;
                RETURN OLD;
            END IF;
            PERFORM refresh_global_search_dataset(NEW.dataset_id);
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION sync_global_search_index_from_files()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                DELETE FROM global_search_index WHERE file_id = OLD.file_id;
                RETURN OLD;
            END IF;
            PERFORM refresh_global_search_file(NEW.file_id);
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION sync_global_search_index_from_tag_dataset()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            PERFORM refresh_global_search_dataset(
                COALESCE(NEW.dataset_id, OLD.dataset_id)
            );
            RETURN COALESCE(NEW, OLD);
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION sync_global_search_index_from_tags()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            r record;
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW.tag_name IS NOT DISTINCT FROM OLD.tag_name THEN
                RETURN NEW;
            END IF;
            FOR r IN
                SELECT dataset_id
                FROM tag_dataset
                WHERE tag_id = COALESCE(NEW.tag_id, OLD.tag_id)
            LOOP
                PERFORM refresh_global_search_dataset(r.dataset_id);
            END LOOP;
            RETURN COALESCE(NEW, OLD);
        END;
        $$;
        """
    )

    op.execute("DROP TRIGGER IF EXISTS trg_sync_global_search_index_datasets ON datasets")
    op.execute(
        """
        CREATE TRIGGER trg_sync_global_search_index_datasets
        AFTER INSERT OR UPDATE OR DELETE ON datasets
        FOR EACH ROW EXECUTE FUNCTION sync_global_search_index_from_datasets()
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_sync_global_search_index_files ON files")
    op.execute(
        """
        CREATE TRIGGER trg_sync_global_search_index_files
        AFTER INSERT OR UPDATE OR DELETE ON files
        FOR EACH ROW EXECUTE FUNCTION sync_global_search_index_from_files()
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_global_search_index_tag_dataset ON tag_dataset"
    )
    op.execute(
        """
        CREATE TRIGGER trg_sync_global_search_index_tag_dataset
        AFTER INSERT OR UPDATE OR DELETE ON tag_dataset
        FOR EACH ROW EXECUTE FUNCTION sync_global_search_index_from_tag_dataset()
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_sync_global_search_index_tags ON tags")
    op.execute(
        """
        CREATE TRIGGER trg_sync_global_search_index_tags
        AFTER UPDATE OR DELETE ON tags
        FOR EACH ROW EXECUTE FUNCTION sync_global_search_index_from_tags()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_global_search_index_tags ON tags"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_global_search_index_tag_dataset ON tag_dataset"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_global_search_index_files ON files"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_sync_global_search_index_datasets ON datasets"
    )
    op.execute("DROP FUNCTION IF EXISTS sync_global_search_index_from_tags()")
    op.execute("DROP FUNCTION IF EXISTS sync_global_search_index_from_tag_dataset()")
    op.execute("DROP FUNCTION IF EXISTS sync_global_search_index_from_files()")
    op.execute("DROP FUNCTION IF EXISTS sync_global_search_index_from_datasets()")
    op.execute("DROP FUNCTION IF EXISTS refresh_global_search_file(uuid)")
    op.execute("DROP FUNCTION IF EXISTS refresh_global_search_dataset(uuid)")
    op.execute("DROP INDEX IF EXISTS ix_global_search_index_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_global_search_index_fts_vector")
    op.execute("DROP INDEX IF EXISTS uq_global_search_index_dataset_file")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
