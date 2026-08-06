-- Reconnects checklist entries whose tool_description_normalized no longer
-- matches the knowledge base.
--
-- NOT YET APPLIED. Run with:
--   node migration/run_04_fix_stranded_checklist.cjs
--
-- Background: widening Pattern A in normalizeToolDescription (so that prefixes
-- like "V6986-2879-" are stripped) made fmea_knowledge_base normalize
-- "Y7557-2869-Chelsea's shoes" to "Chelsea's Shoes". fmea_checklist_standard
-- still held the older un-stripped spelling, so those entries became
-- unreachable from the generate endpoint.
--
-- Verified before writing this file:
--   * fmea_checklist_standard has 0 rows already named "Chelsea's Shoes",
--     so the UNIQUE(tool_description_normalized, failure_mode,
--     sub_concern_index) constraint cannot be violated.
--   * fmea_knowledge_base now has 2 rows named "Chelsea's Shoes" that these
--     entries should serve.

BEGIN;

UPDATE fmea_checklist_standard
SET tool_description_normalized = 'Chelsea''s Shoes',
    updated_at = NOW()
WHERE tool_description_normalized = 'Y7557 2869 Chelsea''s Shoes';

COMMIT;

-- Deliberately NOT handled here, because both need a human decision:
--
-- 1. Six entries have an empty tool_description_normalized. They carry real
--    concerns (one mentions "the edge of the bracelet") but lost their tool
--    name during generation. Mapping them to "Unknown" would attach them to
--    every tool that has no description, which is worse than leaving them
--    unreachable. They need triage against their supporting_record_ids.
--
-- 2. Six entries named "Hairclip" should be "Hair Clip", but five of the six
--    collide with existing "Hair Clip" rows on
--    (tool_description_normalized, failure_mode, sub_concern_index).
--    Resolving that means either discarding them as duplicates or renumbering
--    sub_concern_index, which depends on whether the colliding concerns say
--    the same thing.
