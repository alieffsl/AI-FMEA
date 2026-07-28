/**
 * Clear all existing checklist entries before regeneration
 */

const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function clearChecklist() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    console.log('='.repeat(80));
    console.log('CLEARING FMEA CHECKLIST TABLE');
    console.log('='.repeat(80));
    console.log();
    
    // Get current count
    const countResult = await client.query('SELECT COUNT(*) as count FROM fmea_checklist');
    const currentCount = parseInt(countResult.rows[0].count);
    
    console.log(`Current checklist entries: ${currentCount.toLocaleString()}`);
    console.log();
    
    if (currentCount === 0) {
      console.log('✓ Checklist table is already empty. Nothing to delete.');
      await client.end();
      return;
    }
    
    // Confirm deletion
    console.log('⚠️  WARNING: This will delete ALL checklist entries!');
    console.log();
    console.log('Deleting in 3 seconds... (Press Ctrl+C to cancel)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Delete all entries
    console.log('Deleting...');
    const result = await client.query('DELETE FROM fmea_checklist');
    
    console.log();
    console.log('='.repeat(80));
    console.log('✓ DELETION COMPLETE');
    console.log('='.repeat(80));
    console.log();
    console.log(`Deleted ${currentCount.toLocaleString()} checklist entries`);
    console.log();
    console.log('You can now run: npm run checklist:generate');
    console.log('Or with force: FORCE_REPROCESS=true npm run checklist:generate');
    console.log();
    
    await client.end();
    
  } catch (error) {
    console.error('Error:', error);
    await client.end();
    process.exit(1);
  }
}

clearChecklist();
