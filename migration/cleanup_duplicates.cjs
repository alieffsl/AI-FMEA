const { Client } = require('pg');
require('dotenv').config();

async function cleanupDuplicates() {
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
    
    console.log('Cleaning up duplicate records...');
    console.log('Strategy: Keep the NEWEST record for each toy/tool/failure combination');
    console.log('');
    
    // Delete duplicates, keeping only the record with the latest updated_at
    const result = await client.query(`
      DELETE FROM fmea_knowledge_base
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY toy_num, tool_num, failure_mode 
                   ORDER BY updated_at DESC, created_at DESC
                 ) as rn
          FROM fmea_knowledge_base
        ) ranked
        WHERE rn > 1
      )
    `);
    
    console.log(`✓ Deleted ${result.rowCount} duplicate records`);
    console.log('');
    
    // Verify cleanup
    const verifyResult = await client.query(`
      SELECT COUNT(*) as remaining_duplicates
      FROM (
        SELECT toy_num, tool_num, failure_mode
        FROM fmea_knowledge_base
        GROUP BY toy_num, tool_num, failure_mode
        HAVING COUNT(*) > 1
      ) dup_check
    `);
    
    const totalResult = await client.query(`
      SELECT COUNT(*) as total_records
      FROM fmea_knowledge_base
    `);
    
    console.log('============================================================');
    console.log('CLEANUP COMPLETE');
    console.log('============================================================');
    console.log(`Total records now: ${totalResult.rows[0].total_records}`);
    console.log(`Remaining duplicates: ${verifyResult.rows[0].remaining_duplicates}`);
    console.log('============================================================');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupDuplicates();
