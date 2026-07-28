const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function showExamples() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  // Get the 3 groups we just processed
  const result = await client.query(`
    SELECT 
      tool_description_normalized,
      failure_mode,
      sub_concern_index,
      concern,
      recommendation,
      supporting_record_count,
      supporting_failure_ids
    FROM fmea_checklist
    WHERE (tool_description_normalized IN ('Necklace', 'Belt', 'Torso')
      AND failure_mode = 'First Shot Failure')
      OR tool_description_normalized LIKE 'Torso%'
    ORDER BY tool_description_normalized, sub_concern_index
    LIMIT 30
  `);
  
  console.log('\n' + '='.repeat(80));
  console.log('GENERATED CHECKLIST EXAMPLES');
  console.log('='.repeat(80) + '\n');
  
  let currentTool = '';
  result.rows.forEach(row => {
    if (row.tool_description_normalized !== currentTool) {
      currentTool = row.tool_description_normalized;
      console.log('\n' + '-'.repeat(80));
      console.log(`TOOL: ${row.tool_description_normalized} / FAILURE: ${row.failure_mode}`);
      console.log('-'.repeat(80));
    }
    
    console.log(`\n[${row.sub_concern_index}] Supporting Records: ${row.supporting_record_count}`);
    console.log(`\n✓ CONCERN:`);
    console.log(`  ${row.concern}`);
    console.log(`\n✓ RECOMMENDATION:`);
    console.log(`  ${row.recommendation}`);
    console.log(`\n  Failure IDs: ${row.supporting_failure_ids.slice(0, 5).join(', ')}${row.supporting_failure_ids.length > 5 ? '...' : ''}`);
  });
  
  console.log('\n' + '='.repeat(80) + '\n');
  
  await client.end();
}

showExamples().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
