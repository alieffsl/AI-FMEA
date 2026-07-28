-- 1. Create fmea_projects table
CREATE TABLE IF NOT EXISTS fmea_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code VARCHAR(50) NOT NULL UNIQUE,
    project_name VARCHAR(255) NOT NULL,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create fmea_tools table
CREATE TABLE IF NOT EXISTS fmea_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code VARCHAR(50) REFERENCES fmea_projects(project_code),
    tool_no VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    material VARCHAR(100),
    mold_material VARCHAR(100),
    gate_type VARCHAR(100),
    cavity INT,
    part_weight_g DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create fmea_case_timeline table
CREATE TABLE IF NOT EXISTS fmea_case_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID REFERENCES fmea_knowledge_base(id),
    event_type VARCHAR(50) NOT NULL, -- 'recommendation', 'first_shot', 'first_shot_action', 'next_shot'
    description TEXT NOT NULL,
    logged_by VARCHAR(100),
    logged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Alter fmea_knowledge_base to add missing S/O/D and IDs
ALTER TABLE fmea_knowledge_base
ADD COLUMN IF NOT EXISTS legacy_potential_id INT,
ADD COLUMN IF NOT EXISTS legacy_tool_id INT,
ADD COLUMN IF NOT EXISTS severity INT,
ADD COLUMN IF NOT EXISTS occurrence INT,
ADD COLUMN IF NOT EXISTS detection INT,
ADD COLUMN IF NOT EXISTS rpn INT;

-- 5. Alter fmea_checklist to add baseline scores and verification
ALTER TABLE fmea_checklist
ADD COLUMN IF NOT EXISTS default_severity INT,
ADD COLUMN IF NOT EXISTS default_occurrence INT,
ADD COLUMN IF NOT EXISTS default_detection INT,
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fmea_tools_project ON fmea_tools(project_code);
CREATE INDEX IF NOT EXISTS idx_fmea_timeline_kb_id ON fmea_case_timeline(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_kb_legacy_id ON fmea_knowledge_base(legacy_potential_id);
