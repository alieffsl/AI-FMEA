const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function getSkippedIds() {
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
    
    // Get all skipped records with their failure metadata
    const result = await client.query(`
      SELECT id, toy_num, tool_num, material_gate, failure_mode
      FROM fmea_knowledge_base 
      WHERE learning IS NULL OR final_recommendation IS NULL 
         OR learning = '' OR final_recommendation = ''
      ORDER BY id
    `);
    
    console.log(`Found ${result.rows.length} skipped records`);
    
    // Load raw_fmea_data.json to find matching failureIds
    const rawData = JSON.parse(fs.readFileSync('./raw_fmea_data.json', 'utf8'));
    
    const skippedFailureIds = [];
    
    result.rows.forEach(dbRecord => {
      // Find matching record in raw data
      const match = rawData.find(r => 
        r.toyNum === dbRecord.toy_num &&
        r.toolNum === dbRecord.tool_num &&
        r.materialGate === dbRecord.material_gate &&
        r.failureMode === dbRecord.failure_mode
      );
      
      if (match) {
        skippedFailureIds.push(match.failureId);
        console.log(`- ${dbRecord.toy_num} / ${dbRecord.tool_num} → failureId ${match.failureId}`);
      } else {
        console.log(`- ${dbRecord.toy_num} / ${dbRecord.tool_num} → NOT FOUND in raw data`);
      }
    });
    
    // Save to file
    fs.writeFileSync('./skipped_failure_ids.json', JSON.stringify(skippedFailureIds, null, 2));
    
    console.log('');
    console.log(`Saved ${skippedFailureIds.length} failure IDs to skipped_failure_ids.json`);
    console.log('Failure IDs:', skippedFailureIds.sort((a, b) => a - b).join(', '));
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

getSkippedIds();
