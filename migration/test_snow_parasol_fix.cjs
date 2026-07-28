const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function testFix() {
  const pgClient = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await pgClient.connect();
  
  try {
    const toolDesc = 'Snow Could Parasol LT';
    const failureMode = 'Broken part (Function)';
    
    console.log(`Testing knowledge base fallback for: ${toolDesc} / ${failureMode}`);
    console.log('');
    
    // Query knowledge base for this exact combination
    const kbResult = await pgClient.query(`
      SELECT 
        id,
        learning,
        final_recommendation,
        failure_id
      FROM fmea_knowledge_base
      WHERE tool_description_normalized = $1
        AND failure_mode = $2
      LIMIT 5
    `, [toolDesc, failureMode]);
    
    console.log(`Found ${kbResult.rows.length} records in knowledge base:`);
    console.log('');
    
    for (const row of kbResult.rows) {
      console.log(`ID: ${row.id}`);
      console.log(`Learning: ${row.learning}`);
      console.log(`Recommendation: ${row.final_recommendation}`);
      console.log(`Failure ID: ${row.failure_id}`);
      console.log('---');
    }
    
    if (kbResult.rows.length > 0) {
      console.log('✓ Knowledge base fallback will work for this tool/failure combination');
    } else {
      console.log('✗ No data found in knowledge base');
    }
    
  } finally {
    await pgClient.end();
  }
}

testFix().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
