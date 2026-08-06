const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Applies 04_fix_stranded_checklist_names.sql.
 * Safe to re-run: the UPDATE simply matches nothing the second time.
 */
async function runMigration() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('[Migration] Connected to database');

    const before = await client.query(`
      SELECT COUNT(*)::int AS n FROM fmea_checklist_standard
      WHERE tool_description_normalized = 'Y7557 2869 Chelsea''s Shoes'
    `);
    console.log(`  Stranded entries found: ${before.rows[0].n}`);

    const sql = fs.readFileSync(
      path.join(__dirname, '04_fix_stranded_checklist_names.sql'),
      'utf8'
    );
    await client.query(sql);

    const after = await client.query(`
      SELECT COUNT(*)::int AS n FROM fmea_checklist_standard
      WHERE tool_description_normalized = 'Chelsea''s Shoes'
    `);
    console.log(`✓ Entries now reachable as "Chelsea's Shoes": ${after.rows[0].n}`);

    await client.end();
    console.log('[Migration] Complete!');
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

runMigration();
