const { Client } = require('pg');
require('dotenv').config();

const skippedIds = [165, 363, 459, 5646, 6070, 6312, 6372, 6379, 6382, 6425, 6428, 6670, 6713, 6718, 6736, 6803, 6882];

async function clearSkipped() {
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
    
    console.log(`Clearing synthesis for ${skippedIds.length} failure IDs...`);
    console.log(`IDs: ${skippedIds.join(', ')}`);
    console.log('');
    
    // Clear learning and final_recommendation for skipped records (use empty strings, not NULL)
    const result = await client.query(`
      UPDATE fmea_knowledge_base 
      SET learning = '', final_recommendation = ''
      WHERE learning IS NULL OR final_recommendation IS NULL 
         OR learning = '' OR final_recommendation = ''
    `);
    
    console.log(`Cleared ${result.rowCount} records`);
    console.log('');
    console.log('Now run: npm run synthesize:openai');
    console.log('With FORCE_REPROCESS=true to reprocess these records');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

clearSkipped();
