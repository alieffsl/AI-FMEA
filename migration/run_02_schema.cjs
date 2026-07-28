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
    const sql = fs.readFileSync('./02_normalize_schema.sql', 'utf8');
    await client.query(sql);
    
    console.log('✓ Schema applied successfully');
    
    await client.end();
    console.log('[Migration] Complete!');
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

runMigration();
