/**
 * Verify checklist generation quality
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
});

async function verifyChecklist() {
  console.log('[Verify] Fetching sample checklist entries...\n');
  
  const result = await pool.query(`
    SELECT 
      tool_description_normalized,
      tool_category,
      failure_mode,
      sub_concern_index,
      concern,
      recommendation,
      supporting_record_count,
      supporting_failure_ids
    FROM fmea_checklist
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  for (const row of result.rows) {
    console.log('═'.repeat(80));
    console.log(`Tool: ${row.tool_description_normalized} (${row.tool_category || 'N/A'})`);
    console.log(`Failure Mode: ${row.failure_mode}`);
    console.log(`Sub-concern #${row.sub_concern_index}`);
    console.log(`Supporting Records: ${row.supporting_record_count}`);
    console.log(`Supporting Failure IDs: ${row.supporting_failure_ids?.slice(0, 5).join(', ')}${row.supporting_failure_ids?.length > 5 ? '...' : ''}`);
    console.log('');
    console.log(`Concern:\n  ${row.concern}`);
    console.log('');
    console.log(`Recommendation:\n  ${row.recommendation || 'N/A'}`);
    console.log('');
  }
  
  console.log('═'.repeat(80));
  
  const stats = await pool.query(`
    SELECT 
      COUNT(DISTINCT (tool_description_normalized, failure_mode)) as unique_groups,
      COUNT(*) as total_entries,
      SUM(supporting_record_count) as total_supporting,
      AVG(supporting_record_count) as avg_supporting,
      MIN(supporting_record_count) as min_supporting,
      MAX(supporting_record_count) as max_supporting
    FROM fmea_checklist
  `);
  
  console.log('\nSTATISTICS:');
  console.log(`  Unique (tool × failure) groups: ${stats.rows[0].unique_groups}`);
  console.log(`  Total checklist entries:        ${stats.rows[0].total_entries}`);
  console.log(`  Total supporting records:       ${stats.rows[0].total_supporting}`);
  console.log(`  Avg supporting per entry:       ${parseFloat(stats.rows[0].avg_supporting).toFixed(1)}`);
  console.log(`  Min/Max supporting:             ${stats.rows[0].min_supporting} / ${stats.rows[0].max_supporting}`);
  console.log('');
  
  await pool.end();
}

verifyChecklist().catch(err => {
  console.error('[Verify] Fatal error:', err);
  process.exit(1);
});
