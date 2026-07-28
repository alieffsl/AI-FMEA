/**
 * Run PostgreSQL optimizations for fmea_knowledge_base table
 * This will add indexes to speed up the /knowledge endpoint
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runOptimizations() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('[Optimization] Connected to PostgreSQL');

    // Read SQL file
    const sqlPath = path.join(__dirname, 'optimize_knowledge_base.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.toLowerCase().includes('select')) {
        // For SELECT statements (like index usage query), show results
        const result = await client.query(statement);
        console.log('\n[Index Usage Stats]');
        console.table(result.rows);
      } else {
        // For CREATE INDEX and ANALYZE, just execute
        await client.query(statement);
        const action = statement.match(/CREATE INDEX|ANALYZE/i)?.[0] || 'Execute';
        console.log(`[Optimization] ${action} completed`);
      }
    }

    console.log('\n✅ All optimizations applied successfully!');
    console.log('The /knowledge endpoint should now be much faster.');
    
  } catch (error) {
    console.error('[Optimization] Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runOptimizations();
