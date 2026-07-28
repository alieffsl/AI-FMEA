const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

// Check a specific failure ID to see if it was updated
const testFailureId = 198;

async function checkRecord() {
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
    
    console.log(`Checking failure_id ${testFailureId}...`);
    console.log('');
    
    const result = await client.query(`
      SELECT failure_id, toy_num, tool_num, failure_mode, 
             learning, final_recommendation, updated_at
      FROM fmea_knowledge_base
      WHERE failure_id = $1
    `, [testFailureId]);
    
    if (result.rows.length === 0) {
      console.log('Record not found!');
    } else {
      result.rows.forEach((row, idx) => {
        console.log(`Record ${idx + 1}/${result.rows.length}:`);
        console.log(`  Toy/Tool: ${row.toy_num}/${row.tool_num}`);
        console.log(`  Failure Mode: ${row.failure_mode}`);
        console.log(`  Updated At: ${row.updated_at}`);
        console.log(`  Learning: ${row.learning}`);
        console.log(`  Recommendation: ${row.final_recommendation}`);
        console.log('');
      });
    }
    
    // Check if it has "Observed issue:"
    const hasObserved = result.rows.some(row => 
      row.learning && row.learning.includes('Observed issue:')
    );
    
    console.log(`Has "Observed issue:": ${hasObserved ? 'YES ❌' : 'NO ✓'}`);
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRecord();
