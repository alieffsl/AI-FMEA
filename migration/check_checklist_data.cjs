const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function checkChecklistData() {
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
    // Check total records
    const countResult = await client.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT tool_description_normalized) as unique_tools,
        COUNT(DISTINCT failure_mode) as unique_failures,
        COUNT(DISTINCT (tool_description_normalized, failure_mode)) as unique_groups
      FROM fmea_checklist
    `);
    
    console.log('=== FMEA Checklist Stats ===');
    console.log(JSON.stringify(countResult.rows[0], null, 2));
    console.log('');
    
    // Check for "Snow Could Parasol LT" specifically
    const snowResult = await client.query(`
      SELECT 
        tool_description_normalized,
        failure_mode,
        concern,
        recommendation,
        supporting_record_count
      FROM fmea_checklist
      WHERE tool_description_normalized ILIKE '%Snow Could Parasol%'
      ORDER BY failure_mode, sub_concern_index
    `);
    
    console.log(`=== Snow Could Parasol Entries (${snowResult.rows.length}) ===`);
    for (const row of snowResult.rows) {
      console.log(`Tool: ${row.tool_description_normalized}`);
      console.log(`Failure: ${row.failure_mode}`);
      console.log(`Concern: ${row.concern}`);
      console.log(`Recommendation: ${row.recommendation}`);
      console.log(`Supporting: ${row.supporting_record_count}`);
      console.log('---');
    }
    console.log('');
    
    // Check some sample entries
    const sampleResult = await client.query(`
      SELECT 
        tool_description_normalized,
        failure_mode,
        COUNT(*) as entry_count
      FROM fmea_checklist
      GROUP BY tool_description_normalized, failure_mode
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    
    console.log('=== Top 10 Tool/Failure Combinations ===');
    for (const row of sampleResult.rows) {
      console.log(`${row.tool_description_normalized} / ${row.failure_mode}: ${row.entry_count} entries`);
    }
    
  } finally {
    await client.end();
  }
}

checkChecklistData().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
