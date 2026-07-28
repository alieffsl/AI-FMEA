const { Client } = require('pg');
require('dotenv').config();

async function checkDuplicates() {
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
    
    console.log('Checking for duplicate records...');
    console.log('');
    
    // Find records with duplicate toy_num/tool_num/failure_mode combinations
    const result = await client.query(`
      SELECT toy_num, tool_num, failure_mode, COUNT(*) as count
      FROM fmea_knowledge_base
      GROUP BY toy_num, tool_num, failure_mode
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);
    
    console.log(`Found ${result.rows.length} sets of duplicates`);
    console.log('');
    console.log('Top duplicates:');
    result.rows.slice(0, 10).forEach(row => {
      console.log(`  ${row.toy_num}/${row.tool_num}/${row.failure_mode}: ${row.count} copies`);
    });
    
    // Count total duplicate records
    const totalResult = await client.query(`
      SELECT COUNT(*) as total
      FROM (
        SELECT toy_num, tool_num, failure_mode
        FROM fmea_knowledge_base
        GROUP BY toy_num, tool_num, failure_mode
        HAVING COUNT(*) > 1
      ) dup_groups
    `);
    
    const extraCopiesResult = await client.query(`
      SELECT SUM(count - 1) as extra_copies
      FROM (
        SELECT COUNT(*) as count
        FROM fmea_knowledge_base
        GROUP BY toy_num, tool_num, failure_mode
        HAVING COUNT(*) > 1
      ) counts
    `);
    
    console.log('');
    console.log('============================================================');
    console.log(`Total unique records with duplicates: ${totalResult.rows[0].total}`);
    console.log(`Total extra copies (should be deleted): ${extraCopiesResult.rows[0].extra_copies}`);
    console.log('============================================================');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDuplicates();
