const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  console.log('\n=== Tools in checklist containing "bra" ===');
  const result = await client.query(`
    SELECT DISTINCT tool_description_normalized
    FROM fmea_checklist
    WHERE LOWER(tool_description_normalized) LIKE '%bra%'
    ORDER BY tool_description_normalized
  `);
  
  console.log('Found', result.rows.length, 'tools:');
  result.rows.forEach(r => console.log('  -', r.tool_description_normalized));
  
  console.log('\n=== Checking specific matches for "Bra" + "Improper function" ===');
  const braResult = await client.query(`
    SELECT 
      tool_description_normalized,
      failure_mode,
      concern,
      recommendation,
      supporting_record_count
    FROM fmea_checklist
    WHERE LOWER(failure_mode) = 'improper function'
      AND (LOWER(tool_description_normalized) = 'bra' 
           OR LOWER(tool_description_normalized) = 'bracelet')
    ORDER BY tool_description_normalized, sub_concern_index
  `);
  
  console.log('Found', braResult.rows.length, 'entries:');
  braResult.rows.forEach(r => {
    console.log('\n  Tool:', r.tool_description_normalized);
    console.log('  Concern:', r.concern.substring(0, 80) + '...');
    console.log('  Supporting records:', r.supporting_record_count);
  });
  
  await client.end();
})();
