import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false }
});

async function checkProgress() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN learning IS NOT NULL AND learning != '' THEN 1 END) as with_synthesis,
        COUNT(CASE WHEN learning IS NULL OR learning = '' THEN 1 END) as remaining
      FROM fmea_knowledge_base
    `);
    
    const row = result.rows[0];
    console.log('='.repeat(60));
    console.log('DATABASE PROGRESS CHECK');
    console.log('='.repeat(60));
    console.log(`Total records:      ${row.total}`);
    console.log(`With synthesis:     ${row.with_synthesis} (${Math.round(row.with_synthesis/row.total*100)}%)`);
    console.log(`Remaining:          ${row.remaining} (${Math.round(row.remaining/row.total*100)}%)`);
    console.log('='.repeat(60));
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkProgress();
