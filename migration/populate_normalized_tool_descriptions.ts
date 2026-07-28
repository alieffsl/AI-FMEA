/**
 * Populate tool_description_normalized column in fmea_knowledge_base
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { normalizeToolDescription } from './normalizeToolDescription.js';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
});

async function populateNormalizedDescriptions() {
  console.log('[Populate] Fetching all records with tool_description...');
  
  const result = await pool.query<{ id: string; tool_description: string }>(`
    SELECT id, tool_description
    FROM fmea_knowledge_base
    WHERE tool_description IS NOT NULL
  `);
  
  console.log(`[Populate] Processing ${result.rows.length} records...`);
  
  let updated = 0;
  const batchSize = 100;
  
  for (let i = 0; i < result.rows.length; i += batchSize) {
    const batch = result.rows.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(row =>
        pool.query(
          'UPDATE fmea_knowledge_base SET tool_description_normalized = $1 WHERE id = $2',
          [normalizeToolDescription(row.tool_description), row.id]
        )
      )
    );
    
    updated += batch.length;
    if (updated % 500 === 0) {
      console.log(`  Progress: ${updated}/${result.rows.length} records updated`);
    }
  }
  
  console.log('');
  console.log('============================================================');
  console.log(`✓ Updated ${updated} records with normalized tool descriptions`);
  console.log('============================================================');
  
  await pool.end();
}

populateNormalizedDescriptions().catch(err => {
  console.error('[Populate] Fatal error:', err);
  process.exit(1);
});
