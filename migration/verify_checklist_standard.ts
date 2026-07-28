import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const stats = await pool.query(`
    SELECT
      COUNT(*)::int AS total_entries,
      COUNT(DISTINCT (tool_description_normalized, failure_mode))::int AS unique_groups,
      COUNT(DISTINCT tool_description_normalized)::int AS unique_tools,
      COUNT(*) FILTER (WHERE 'historical_fmea' = ANY(source_types))::int AS historical_entries,
      COUNT(*) FILTER (WHERE 'product_standard' = ANY(source_types))::int AS product_standard_entries,
      COUNT(*) FILTER (WHERE 'baseline_standard' = ANY(source_types))::int AS baseline_standard_entries,
      COUNT(*) FILTER (WHERE applicability_scope = 'global_process')::int AS global_process_entries,
      COUNT(*) FILTER (WHERE jsonb_array_length(supporting_standard_refs) > 0)::int AS entries_with_standard_refs,
      COUNT(*) FILTER (WHERE concern = '' OR recommendation = '')::int AS empty_entries
    FROM fmea_checklist_standard
  `);

  const missingHistorical = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM fmea_checklist old
    WHERE NOT EXISTS (
      SELECT 1
      FROM fmea_checklist_standard combined
      WHERE old.id = ANY(combined.historical_checklist_ids)
    )
  `);

  const duplicates = await pool.query(`
    SELECT tool_description_normalized, failure_mode, sub_concern_index, COUNT(*)::int
    FROM fmea_checklist_standard
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
  `);

  const duplicateContent = await pool.query(`
    SELECT
      tool_description_normalized,
      failure_mode,
      COUNT(*)::int AS duplicate_count
    FROM fmea_checklist_standard
    GROUP BY
      tool_description_normalized,
      failure_mode,
      LOWER(REGEXP_REPLACE(TRIM(concern), '\\s+', ' ', 'g')),
      LOWER(REGEXP_REPLACE(TRIM(recommendation), '\\s+', ' ', 'g'))
    HAVING COUNT(*) > 1
  `);

  const invalidProvenance = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM fmea_checklist_standard
    WHERE (
      ('product_standard' = ANY(source_types) OR 'baseline_standard' = ANY(source_types))
      AND jsonb_array_length(supporting_standard_refs) = 0
    )
  `);

  const samples = await pool.query(`
    SELECT tool_description_normalized, failure_mode, concern, recommendation,
      source_types, supporting_record_count,
      jsonb_array_length(supporting_standard_refs) AS standard_ref_count
    FROM fmea_checklist_standard
    WHERE 'product_standard' = ANY(source_types) OR 'baseline_standard' = ANY(source_types)
    ORDER BY supporting_record_count DESC, tool_description_normalized
    LIMIT 20
  `);

  console.log('[Verification] Overview');
  console.table(stats.rows);
  console.log(`[Verification] Missing historical checklist rows: ${missingHistorical.rows[0].count}`);
  console.log(`[Verification] Duplicate unique keys: ${duplicates.rows.length}`);
  console.log(`[Verification] Duplicate concern/recommendation pairs: ${duplicateContent.rows.length}`);
  if (duplicateContent.rows.length) console.table(duplicateContent.rows.slice(0, 20));
  console.log(`[Verification] Invalid standard provenance: ${invalidProvenance.rows[0].count}`);
  console.log('[Verification] Standards-backed samples');
  console.table(samples.rows);

  const failed =
    stats.rows[0].empty_entries > 0 ||
    missingHistorical.rows[0].count > 0 ||
    duplicates.rows.length > 0 ||
    duplicateContent.rows.length > 0 ||
    invalidProvenance.rows[0].count > 0;
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[Verification] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
