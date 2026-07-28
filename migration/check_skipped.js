const { Client } = require('pg');
require('dotenv').config();

async function checkSkipped() {
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
    
    // Check for records without synthesis
    const nullCheck = await client.query(`
      SELECT COUNT(*) as total 
      FROM fmea_knowledge_base 
      WHERE learning IS NULL OR final_recommendation IS NULL
    `);
    
    // Check for records with empty strings
    const emptyCheck = await client.query(`
      SELECT COUNT(*) as total 
      FROM fmea_knowledge_base 
      WHERE learning = '' OR final_recommendation = ''
    `);
    
    // Get sample IDs of skipped records
    const samples = await client.query(`
      SELECT id, toy_num, tool_num, failure_mode, learning, final_recommendation
      FROM fmea_knowledge_base 
      WHERE learning IS NULL OR final_recommendation IS NULL 
         OR learning = '' OR final_recommendation = ''
      ORDER BY id
      LIMIT 10
    `);
    
    console.log('============================================================');
    console.log('SKIPPED RECORDS CHECK');
    console.log('============================================================');
    console.log('Records with NULL synthesis:', nullCheck.rows[0].total);
    console.log('Records with empty string synthesis:', emptyCheck.rows[0].total);
    console.log('Total skipped:', parseInt(nullCheck.rows[0].total) + parseInt(emptyCheck.rows[0].total));
    console.log('');
    
    if (samples.rows.length > 0) {
      console.log('Sample skipped records:');
      samples.rows.forEach(row => {
        console.log(`- ID ${row.id}: ${row.toy_num} / ${row.tool_num} / ${row.failure_mode}`);
        console.log(`  Learning: ${row.learning || 'NULL'}`);
        console.log(`  Recommendation: ${row.final_recommendation || 'NULL'}`);
      });
    }
    console.log('============================================================');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSkipped();
