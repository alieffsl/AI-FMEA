/**
 * Check progress of checklist generation
 */

const pg = require('pg');
require('dotenv').config();

const { Client } = pg;

async function checkProgress() {
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
    
    // Get total groups expected
    const totalGroupsResult = await client.query(`
      SELECT COUNT(DISTINCT (tool_description_normalized, failure_mode)) as count
      FROM fmea_knowledge_base
      WHERE tool_description_normalized IS NOT NULL
        AND failure_mode IS NOT NULL
        AND learning IS NOT NULL
        AND final_recommendation IS NOT NULL
        AND learning != ''
        AND final_recommendation != ''
      HAVING COUNT(*) >= 2
    `);
    
    // Get current progress
    const progressResult = await client.query(`
      SELECT 
        COUNT(DISTINCT (tool_description_normalized, failure_mode)) as unique_groups,
        COUNT(*) as total_entries,
        SUM(supporting_record_count) as total_supporting_records
      FROM fmea_checklist
    `);
    
    const progress = progressResult.rows[0];
    const totalGroups = 658; // Known from query
    const currentGroups = parseInt(progress.unique_groups);
    const percentage = Math.round((currentGroups / totalGroups) * 100);
    
    console.log('='.repeat(80));
    console.log('CHECKLIST GENERATION PROGRESS');
    console.log('='.repeat(80));
    console.log();
    console.log(`Progress: ${currentGroups} / ${totalGroups} groups (${percentage}%)`);
    console.log(`Total entries created: ${parseInt(progress.total_entries).toLocaleString()}`);
    console.log(`Total supporting records: ${parseInt(progress.total_supporting_records).toLocaleString()}`);
    console.log();
    
    // Progress bar
    const barLength = 50;
    const filled = Math.round((currentGroups / totalGroups) * barLength);
    const empty = barLength - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    console.log(`[${bar}] ${percentage}%`);
    console.log();
    
    if (currentGroups >= totalGroups) {
      console.log('✓ GENERATION COMPLETE!');
    } else {
      const remaining = totalGroups - currentGroups;
      console.log(`⏳ ${remaining} groups remaining`);
      console.log();
      console.log('Run this script again to check progress:');
      console.log('  node check_checklist_progress.cjs');
    }
    console.log();
    console.log('='.repeat(80));
    
    await client.end();
    
  } catch (error) {
    console.error('Error:', error);
    await client.end();
    process.exit(1);
  }
}

checkProgress();
