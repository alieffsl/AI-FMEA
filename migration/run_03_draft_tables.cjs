const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Applies 03_create_draft_tables.sql (draft persistence).
 * Safe to re-run: every statement in the file is guarded with IF NOT EXISTS.
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

    const sql = fs.readFileSync(path.join(__dirname, '03_create_draft_tables.sql'), 'utf8');
    await client.query(sql);

    console.log('✓ Draft tables applied successfully');

    const check = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('fmea_draft', 'fmea_draft_row')
      ORDER BY table_name
    `);
    console.log('  Tables present:', check.rows.map((r) => r.table_name).join(', '));

    await client.end();
    console.log('[Migration] Complete!');
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

runMigration();
