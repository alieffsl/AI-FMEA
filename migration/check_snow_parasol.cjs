const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function checkSnowParasol() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  
  try {
    // Check knowledge base for Snow Could Parasol
    const kbResult = await client.query(`
      SELECT 
        tool_description_normalized,
        failure_mode,
        COUNT(*) as record_count
      FROM fmea_knowledge_base
      WHERE tool_description_normalized ILIKE '%Snow Could Parasol%'
      GROUP BY tool_description_normalized, failure_mode
      ORDER BY COUNT(*) DESC
    `);
    
    console.log('=== Snow Could Parasol in Knowledge Base ===');
    console.log(`Total groups: ${kbResult.rows.length}`);
    console.log('');
    for (const row of kbResult.rows) {
      console.log(`${row.tool_description_normalized} / ${row.failure_mode}: ${row.record_count} records`);
    }
    console.log('');
    
    // Check what tool descriptions are similar
    const similarResult = await client.query(`
      SELECT 
        tool_description_normalized,
        COUNT(*) as record_count
      FROM fmea_knowledge_base
      WHERE tool_description_normalized ILIKE '%parasol%'
        OR tool_description_normalized ILIKE '%snow%'
      GROUP BY tool_description_normalized
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);
    
    console.log('=== Similar Tool Descriptions ===');
    for (const row of similarResult.rows) {
      console.log(`${row.tool_description_normalized}: ${row.record_count} records`);
    }
    
  } finally {
    await client.end();
  }
}

checkSnowParasol().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
