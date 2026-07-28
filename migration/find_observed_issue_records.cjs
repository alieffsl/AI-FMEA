const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function findObservedIssueRecords() {
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
    
    console.log('Searching for records with "Observed issue:" in learning field...');
    console.log('');
    
    // Find all records with "Observed issue:" in learning
    const result = await client.query(`
      SELECT failure_id, toy_num, tool_num, failure_mode, learning, final_recommendation
      FROM fmea_knowledge_base
      WHERE learning LIKE '%Observed issue:%'
      ORDER BY failure_id
    `);
    
    console.log(`Found ${result.rows.length} records with "Observed issue:" pattern`);
    console.log('');
    
    // Extract failure_ids
    const failureIds = result.rows
      .filter(row => row.failure_id !== null)
      .map(row => row.failure_id);
    
    const uniqueFailureIds = [...new Set(failureIds)].sort((a, b) => a - b);
    
    console.log('Sample records:');
    result.rows.slice(0, 10).forEach(row => {
      console.log(`  - Failure ID ${row.failure_id}: ${row.toy_num}/${row.tool_num}`);
      console.log(`    Learning: ${row.learning.substring(0, 100)}...`);
      console.log(`    Recommendation: ${row.final_recommendation ? row.final_recommendation.substring(0, 80) : 'NULL'}...`);
      console.log('');
    });
    
    console.log('============================================================');
    console.log(`Total unique failure IDs to reprocess: ${uniqueFailureIds.length}`);
    console.log('============================================================');
    console.log('');
    console.log('Failure IDs:', uniqueFailureIds.join(', '));
    console.log('');
    
    // Save to file
    fs.writeFileSync('./observed_issue_failure_ids.json', JSON.stringify(uniqueFailureIds, null, 2));
    console.log('✓ Saved to observed_issue_failure_ids.json');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findObservedIssueRecords();
