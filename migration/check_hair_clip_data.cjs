const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  console.log('\n========================================');
  console.log('=== Checking fmea_checklist ===');
  console.log('========================================');
  const checklistResult = await client.query(`
    SELECT COUNT(*) as count
    FROM fmea_checklist
    WHERE LOWER(tool_description_normalized) = 'hair clip'
      AND LOWER(failure_mode) = 'fail life test'
  `);
  console.log('Hair Clip + "Fail life test" in fmea_checklist:', checklistResult.rows[0].count, 'entries');
  
  console.log('\n========================================');
  console.log('=== Checking fmea_knowledge_base ===');
  console.log('========================================');
  const knowledgeResult = await client.query(`
    SELECT COUNT(*) as count
    FROM fmea_knowledge_base
    WHERE LOWER(tool_description_normalized) = 'hair clip'
      AND LOWER(failure_mode) = 'fail life test'
  `);
  console.log('Hair Clip + "Fail life test" in fmea_knowledge_base:', knowledgeResult.rows[0].count, 'entries');
  
  // Also check what failure modes DO exist for Hair Clip in checklist
  console.log('\n========================================');
  console.log('=== Failure modes for Hair Clip in fmea_checklist ===');
  console.log('========================================');
  const hairClipModes = await client.query(`
    SELECT DISTINCT failure_mode, COUNT(*) as entry_count
    FROM fmea_checklist
    WHERE LOWER(tool_description_normalized) = 'hair clip'
    GROUP BY failure_mode
    ORDER BY entry_count DESC
    LIMIT 20
  `);
  
  if (hairClipModes.rows.length > 0) {
    console.log('Found', hairClipModes.rows.length, 'distinct failure modes for Hair Clip:');
    hairClipModes.rows.forEach(row => {
      console.log('  -', row.failure_mode, '(' + row.entry_count + ' entries)');
    });
  } else {
    console.log('❌ NO failure modes found for Hair Clip in fmea_checklist');
  }
  
  // Check if Hair Clip exists at all in checklist
  console.log('\n========================================');
  console.log('=== All Hair Clip related tools in fmea_checklist ===');
  console.log('========================================');
  const allHairClip = await client.query(`
    SELECT DISTINCT tool_description_normalized, tool_category, COUNT(*) as entry_count
    FROM fmea_checklist
    WHERE LOWER(tool_description_normalized) LIKE '%hair%clip%'
       OR LOWER(tool_description_normalized) LIKE '%hairclip%'
    GROUP BY tool_description_normalized, tool_category
    ORDER BY entry_count DESC
  `);
  
  if (allHairClip.rows.length > 0) {
    console.log('Found', allHairClip.rows.length, 'hair clip variations:');
    allHairClip.rows.forEach(row => {
      console.log('  -', row.tool_description_normalized, '(Category:', row.tool_category + ')', '→', row.entry_count, 'entries');
    });
  } else {
    console.log('❌ NO hair clip tools found in fmea_checklist at all!');
  }
  
  // Check what failure modes exist for Hair Clip in knowledge base
  console.log('\n========================================');
  console.log('=== Failure modes for Hair Clip in fmea_knowledge_base ===');
  console.log('========================================');
  const knowledgeModes = await client.query(`
    SELECT DISTINCT failure_mode, COUNT(*) as record_count
    FROM fmea_knowledge_base
    WHERE LOWER(tool_description_normalized) = 'hair clip'
    GROUP BY failure_mode
    ORDER BY record_count DESC
    LIMIT 20
  `);
  
  if (knowledgeModes.rows.length > 0) {
    console.log('Found', knowledgeModes.rows.length, 'distinct failure modes for Hair Clip:');
    knowledgeModes.rows.forEach(row => {
      console.log('  -', row.failure_mode, '(' + row.record_count + ' records)');
    });
  } else {
    console.log('❌ NO failure modes found for Hair Clip in fmea_knowledge_base');
  }
  
  // Check total entries in both tables
  console.log('\n========================================');
  console.log('=== Database Statistics ===');
  console.log('========================================');
  const checklistTotal = await client.query('SELECT COUNT(*) as count FROM fmea_checklist');
  const knowledgeTotal = await client.query('SELECT COUNT(*) as count FROM fmea_knowledge_base');
  
  console.log('fmea_checklist total entries:', checklistTotal.rows[0].count);
  console.log('fmea_knowledge_base total entries:', knowledgeTotal.rows[0].count);
  
  await client.end();
  
  console.log('\n========================================');
  console.log('✅ Analysis Complete');
  console.log('========================================');
})();
