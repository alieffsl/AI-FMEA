const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function runMigration() {
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
    console.log('[Migration] Connected to database');
    
    // Read and execute SQL
    const sql = fs.readFileSync('./create_checklist_table.sql', 'utf8');
    await client.query(sql);
    
    console.log('✓ Created fmea_checklist table');
    console.log('✓ Added tool_description_normalized column to fmea_knowledge_base');
    console.log('✓ Created indexes');
    
    await client.end();
    console.log('[Migration] Complete!');
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

runMigration();
