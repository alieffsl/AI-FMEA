-- Optimization script for fmea_knowledge_base table
-- Run this to speed up /knowledge endpoint queries

-- 1. Add index on tool_description_normalized (most common filter)
CREATE INDEX IF NOT EXISTS idx_tool_description_normalized 
ON fmea_knowledge_base(tool_description_normalized);

-- 2. Add index on created_at (for ORDER BY)
CREATE INDEX IF NOT EXISTS idx_created_at 
ON fmea_knowledge_base(created_at DESC);

-- 3. Add composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_tool_desc_created 
ON fmea_knowledge_base(tool_description_normalized, created_at DESC);

-- 4. Add indexes for other filter columns
CREATE INDEX IF NOT EXISTS idx_toy_name 
ON fmea_knowledge_base(toy_name);

CREATE INDEX IF NOT EXISTS idx_tool_category 
ON fmea_knowledge_base(tool_category);

CREATE INDEX IF NOT EXISTS idx_failure_mode 
ON fmea_knowledge_base(failure_mode);

CREATE INDEX IF NOT EXISTS idx_status 
ON fmea_knowledge_base(status);

-- 5. Analyze table to update statistics
ANALYZE fmea_knowledge_base;

-- Show index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'fmea_knowledge_base'
ORDER BY idx_scan DESC;
