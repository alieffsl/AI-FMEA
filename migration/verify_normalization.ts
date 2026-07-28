/**
 * Verify that tool descriptions have been properly normalized in the database
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

async function verifyNormalization() {
  console.log('🔍 Checking sample normalized tool descriptions...\n');
  console.log('='.repeat(80));
  
  // Get sample records that should have had prefixes stripped
  const result = await pool.query<{
    tool_description: string;
    tool_description_normalized: string;
    count: number;
  }>(`
    SELECT 
      tool_description,
      tool_description_normalized,
      COUNT(*) as count
    FROM fmea_knowledge_base
    WHERE tool_description_normalized IS NOT NULL
    GROUP BY tool_description, tool_description_normalized
    ORDER BY count DESC
    LIMIT 30
  `);
  
  console.log('\nTop 30 most common normalized tool descriptions:\n');
  
  for (const row of result.rows) {
    const wasChanged = row.tool_description !== row.tool_description_normalized;
    const icon = wasChanged ? '✅' : '  ';
    
    console.log(`${icon} Raw: "${row.tool_description}"`);
    console.log(`   Normalized: "${row.tool_description_normalized}" (${row.count} records)`);
    console.log();
  }
  
  console.log('='.repeat(80));
  
  // Check for specific patterns from the screenshot
  const patterns = [
    'Jfg71 009%',
    'Jjb33 001%',
    'Jtv75 001%',
    'Jjb%',
    'Jtv%'
  ];
  
  console.log('\n🔍 Checking for space-separated prefixes that should be stripped:\n');
  
  for (const pattern of patterns) {
    const checkResult = await pool.query<{
      tool_description: string;
      tool_description_normalized: string;
    }>(`
      SELECT DISTINCT tool_description, tool_description_normalized
      FROM fmea_knowledge_base
      WHERE tool_description LIKE $1
      LIMIT 5
    `, [pattern]);
    
    if (checkResult.rows.length > 0) {
      console.log(`Pattern: ${pattern}`);
      for (const row of checkResult.rows) {
        console.log(`  "${row.tool_description}" → "${row.tool_description_normalized}"`);
      }
      console.log();
    }
  }
  
  console.log('='.repeat(80));
  console.log('✅ Verification complete!\n');
  
  await pool.end();
}

verifyNormalization().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
