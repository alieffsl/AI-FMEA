-- Combined historical-FMEA and Product/Baseline Standards checklist.
-- This table is separate from fmea_checklist so the proven historical
-- checklist remains available for comparison and rollback.

CREATE TABLE IF NOT EXISTS fmea_checklist_standard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Runtime-compatible grouping fields
    tool_description_normalized VARCHAR(255) NOT NULL,
    tool_category VARCHAR(100),
    failure_mode VARCHAR(255) NOT NULL,
    sub_concern_index INT NOT NULL DEFAULT 1,
    concern TEXT NOT NULL,
    recommendation TEXT NOT NULL,

    -- Applicability and provenance
    applicability_scope VARCHAR(30) NOT NULL DEFAULT 'exact_tool'
        CHECK (applicability_scope IN ('exact_tool', 'global_process')),
    source_types TEXT[] NOT NULL DEFAULT '{}',
    historical_checklist_ids UUID[] NOT NULL DEFAULT '{}',
    supporting_record_count INT NOT NULL DEFAULT 0,
    supporting_record_ids UUID[] NOT NULL DEFAULT '{}',
    supporting_failure_ids INT[] NOT NULL DEFAULT '{}',
    supporting_standard_refs JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Risk defaults copied from historical evidence when available
    default_severity INT,
    default_occurrence INT,
    default_detection INT,

    -- Retrieval and generation metadata
    embedding JSONB,
    ai_model VARCHAR(100),
    prompt_version VARCHAR(50) NOT NULL,
    generation_run_id UUID NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE(tool_description_normalized, failure_mode, sub_concern_index)
);

CREATE INDEX IF NOT EXISTS idx_checklist_standard_tool
    ON fmea_checklist_standard(tool_description_normalized);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_failure
    ON fmea_checklist_standard(failure_mode);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_category
    ON fmea_checklist_standard(tool_category);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_scope
    ON fmea_checklist_standard(applicability_scope);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_source_types
    ON fmea_checklist_standard USING GIN(source_types);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_refs
    ON fmea_checklist_standard USING GIN(supporting_standard_refs);
CREATE INDEX IF NOT EXISTS idx_checklist_standard_run
    ON fmea_checklist_standard(generation_run_id);
