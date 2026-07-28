const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

const failureIds = [165, 363, 459, 5646, 6070, 6312, 6372, 6379, 6382, 6425, 6428, 6670, 6713, 6718, 6736, 6803, 6882];

async function mapIds() {
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
    
    // Load raw data to get the mapping
    const rawData = JSON.parse(fs.readFileSync('./raw_fmea_data.json', 'utf8'));
    
    console.log('Mapping failure IDs to database IDs...');
    console.log('');
    
    const dbIds = [];
    const notFound = [];
    
    for (const failureId of failureIds) {
      // Find record in raw data
      const rawRecord = rawData.find(r => r.failureId === failureId);
      
      if (!rawRecord) {
        console.log(`✗ failureId ${failureId} - NOT FOUND in raw_fmea_data.json`);
        notFound.push(failureId);
        continue;
      }
      
      // Find matching record in database
      const result = await client.query(`
        SELECT id, toy_num, tool_num, failure_mode
        FROM fmea_knowledge_base
        WHERE toy_num = $1 
          AND tool_num = $2 
          AND material_gate = $3 
          AND failure_mode = $4
      `, [rawRecord.toyNum, rawRecord.toolNum, rawRecord.materialGate, rawRecord.failureMode]);
      
      if (result.rows.length === 0) {
        console.log(`✗ failureId ${failureId} (${rawRecord.toyNum}/${rawRecord.toolNum}) - NOT FOUND in database`);
        notFound.push(failureId);
      } else if (result.rows.length > 1) {
        console.log(`⚠ failureId ${failureId} (${rawRecord.toyNum}/${rawRecord.toolNum}) - MULTIPLE MATCHES (${result.rows.length})`);
        // Take the first match
        dbIds.push(result.rows[0].id);
      } else {
        console.log(`✓ failureId ${failureId} (${rawRecord.toyNum}/${rawRecord.toolNum}) → ${result.rows[0].id}`);
        dbIds.push(result.rows[0].id);
      }
    }
    
    console.log('');
    console.log('============================================================');
    console.log(`Found ${dbIds.length} database IDs`);
    console.log(`Not found: ${notFound.length}`);
    console.log('============================================================');
    
    // Save to file
    fs.writeFileSync('./db_ids_to_reprocess.json', JSON.stringify(dbIds, null, 2));
    console.log('Saved database IDs to db_ids_to_reprocess.json');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

mapIds();
