-- Add missing supporting_failure_ids column to fmea_checklist table

ALTER TABLE fmea_checklist 
ADD COLUMN IF NOT EXISTS supporting_failure_ids INT[] NOT NULL DEFAULT '{}';
