const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function addFailureIdColumn() {
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
    
    console.log('Step 1: Adding failure_id column to fmea_knowledge_base...');
    
    // Add the column if it doesn't exist
    await client.query(`
      ALTER TABLE fmea_knowledge_base 
      ADD COLUMN IF NOT EXISTS failure_id INTEGER
    `);
    
    console.log('✓ Column added (or already exists)');
    console.log('');
    console.log('Step 2: Loading raw_fmea_data.json...');
    
    // Load raw data
    const rawData = JSON.parse(fs.readFileSync('./raw_fmea_data.json', 'utf8'));
    console.log(`✓ Loaded ${rawData.length} records from raw_fmea_data.json`);
    console.log('');
    console.log('Step 3: Mapping and updating failure_id for each record...');
    
    let updated = 0;
    let notFound = 0;
    let multipleMatches = 0;
    
    for (const rawRecord of rawData) {
      // Find matching record in database
      const result = await client.query(`
        SELECT id 
        FROM fmea_knowledge_base
        WHERE toy_num = $1 
          AND tool_num = $2 
          AND material_gate = $3 
          AND failure_mode = $4
      `, [rawRecord.toyNum, rawRecord.toolNum, rawRecord.materialGate, rawRecord.failureMode]);
      
      if (result.rows.length === 0) {
        notFound++;
        if (notFound <= 5) {
          console.log(`  ✗ Not found: ${rawRecord.toyNum}/${rawRecord.toolNum}/${rawRecord.failureMode}`);
        }
      } else if (result.rows.length > 1) {
        multipleMatches++;
        // Update all matches with the same failureId
        for (const row of result.rows) {
          await client.query(`
            UPDATE fmea_knowledge_base 
            SET failure_id = $1 
            WHERE id = $2
          `, [rawRecord.failureId, row.id]);
        }
        updated += result.rows.length;
      } else {
        // Single match - update it
        await client.query(`
          UPDATE fmea_knowledge_base 
          SET failure_id = $1 
          WHERE id = $2
        `, [rawRecord.failureId, result.rows[0].id]);
        updated++;
      }
      
      // Progress indicator
      if (updated % 500 === 0) {
        console.log(`  Progress: ${updated} records updated...`);
      }
    }
    
    console.log('');
    console.log('============================================================');
    console.log('MIGRATION COMPLETE');
    console.log('============================================================');
    console.log(`✓ Updated: ${updated} records`);
    console.log(`✗ Not found in DB: ${notFound} records`);
    console.log(`⚠ Multiple matches: ${multipleMatches} records`);
    console.log('============================================================');
    
    // Verify
    const countResult = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(failure_id) as with_failure_id,
             COUNT(*) - COUNT(failure_id) as without_failure_id
      FROM fmea_knowledge_base
    `);
    
    console.log('');
    console.log('Verification:');
    console.log(`  Total records: ${countResult.rows[0].total}`);
    console.log(`  With failure_id: ${countResult.rows[0].with_failure_id}`);
    console.log(`  Without failure_id: ${countResult.rows[0].without_failure_id}`);
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addFailureIdColumn();
