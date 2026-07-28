const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
});

async function addColumn() {
  try {
    console.log('Adding supporting_failure_ids column to fmea_checklist...');
    
    await pool.query(`
      ALTER TABLE fmea_checklist 
      ADD COLUMN IF NOT EXISTS supporting_failure_ids INT[] NOT NULL DEFAULT '{}'
    `);
    
    console.log('✓ Column added successfully');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

addColumn();
