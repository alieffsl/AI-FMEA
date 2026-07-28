-- FMEA Historical Checklist Table
-- Pre-computed checklist library from knowledge base records

-- Enable pgvector extension (if available)
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS fmea_checklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Grouping keys
    tool_description_normalized VARCHAR(255) NOT NULL,
    tool_category VARCHAR(100),
    failure_mode VARCHAR(255) NOT NULL,
    
    -- AI-generated content (consolidated sub-concerns)
    sub_concern_index INT NOT NULL DEFAULT 1,
    concern TEXT NOT NULL,              -- The checklist concern statement
    recommendation TEXT,                -- Consolidated recommendation
    
    -- Provenance
    supporting_record_count INT NOT NULL DEFAULT 0,
    supporting_record_ids UUID[] NOT NULL DEFAULT '{}',
    supporting_failure_ids INT[] NOT NULL DEFAULT '{}',
    
    -- Embedding for semantic matching (stored as JSONB if pgvector not available)
    embedding JSONB,  -- Will store as array: [0.123, -0.456, ...]
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Composite uniqueness
    UNIQUE(tool_description_normalized, failure_mode, sub_concern_index)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checklist_tool_desc ON fmea_checklist(tool_description_normalized);
CREATE INDEX IF NOT EXISTS idx_checklist_failure ON fmea_checklist(failure_mode);
CREATE INDEX IF NOT EXISTS idx_checklist_category ON fmea_checklist(tool_category);
CREATE INDEX IF NOT EXISTS idx_checklist_updated ON fmea_checklist(updated_at DESC);

-- Add normalized column to knowledge base
ALTER TABLE fmea_knowledge_base 
ADD COLUMN IF NOT EXISTS tool_description_normalized VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_kb_tool_normalized ON fmea_knowledge_base(tool_description_normalized);
