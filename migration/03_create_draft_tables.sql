-- Draft FMEA persistence.
--
-- Before this, a generated draft lived only in React state: a refresh, a stray
-- navigation, or a crash destroyed the whole session, and there was no way to
-- resume work or to review a draft later.
--
-- Apply with:
--   psql "$PG_CONNECTION_STRING" -f migration/03_create_draft_tables.sql
--
-- Safe to re-run: every statement is guarded.

CREATE TABLE IF NOT EXISTS fmea_draft (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Project context, copied from the parsed CDI workbook.
    project_name VARCHAR(255),
    source_filename VARCHAR(255),

    -- Full ProjectMetadata as parsed, so a restored draft shows the same
    -- header cards without needing the original workbook.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Stable hash of the generated content. This lets re-generating the same
    -- CDI draft reuse the existing record instead of creating duplicates.
    content_fingerprint VARCHAR(64),

    -- The application has no authentication yet, so this is best-effort: the
    -- API records the X-FMEA-User header when a proxy supplies one. Once SSO
    -- lands this becomes the real owner column.
    created_by VARCHAR(150),

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fmea_draft_row (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL REFERENCES fmea_draft(id) ON DELETE CASCADE,

    -- Preserves the order the rows were presented in.
    row_index INT NOT NULL,

    -- Promoted from the payload so drafts can be filtered and reported on
    -- without unpacking JSON.
    tool_row_id VARCHAR(100),
    tool_no VARCHAR(100),
    part_description VARCHAR(255),
    failure_mode VARCHAR(255),
    severity INT,
    occurrence INT,
    detection INT,
    rpn INT,
    has_evidence BOOLEAN NOT NULL DEFAULT TRUE,

    -- The complete FmeaDraftRow, including checklistEntries with their
    -- provenance, so a restored draft keeps its evidence trail.
    payload JSONB NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (draft_id, row_index)
);

ALTER TABLE fmea_draft
    ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_fmea_draft_updated
    ON fmea_draft(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fmea_draft_content_fingerprint
    ON fmea_draft(content_fingerprint)
    WHERE content_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fmea_draft_created_by
    ON fmea_draft(created_by);
CREATE INDEX IF NOT EXISTS idx_fmea_draft_row_draft
    ON fmea_draft_row(draft_id, row_index);
CREATE INDEX IF NOT EXISTS idx_fmea_draft_row_rpn
    ON fmea_draft_row(rpn DESC);
