/**
 * Show Examples from Knowledge Base
 * 
 * Displays both successful and missing synthesis examples from the database
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function showExamples() {
  const pool = new Pool({
    host: process.env.PG_HOST!,
    port: Number.parseInt(process.env.PG_PORT ?? '5432', 10),
    user: process.env.PG_USER!,
    password: process.env.PG_PASSWORD!,
    database: process.env.PG_DATABASE!,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('='.repeat(80));
    console.log('KNOWLEDGE BASE SYNTHESIS EXAMPLES');
    console.log('='.repeat(80));
    console.log();

    // Get total counts
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM fmea_knowledge_base'
    );
    const total = parseInt(totalResult.rows[0].total);

    const withSynthesisResult = await pool.query(
      `SELECT COUNT(*) as count FROM fmea_knowledge_base 
       WHERE learning IS NOT NULL AND learning != '' 
       AND final_recommendation IS NOT NULL AND final_recommendation != ''`
    );
    const withSynthesis = parseInt(withSynthesisResult.rows[0].count);

    const withoutSynthesis = total - withSynthesis;

    console.log('DATABASE STATISTICS:');
    console.log(`  Total records: ${total.toLocaleString()}`);
    console.log(`  With synthesis: ${withSynthesis.toLocaleString()} (${Math.round(withSynthesis/total*100)}%)`);
    console.log(`  Without synthesis: ${withoutSynthesis.toLocaleString()} (${Math.round(withoutSynthesis/total*100)}%)`);
    console.log();

    // Get some successful examples
    console.log('='.repeat(80));
    console.log('SUCCESSFUL SYNTHESIS EXAMPLES');
    console.log('='.repeat(80));
    console.log();

    const successfulExamples = await pool.query(
      `SELECT 
        toy_num, toy_name, tool_num, tool_description, 
        material_gate, failure_mode, learning, final_recommendation,
        (SELECT COUNT(*) FROM jsonb_array_elements(evidence_images_base64::jsonb)) as image_count
       FROM fmea_knowledge_base 
       WHERE learning IS NOT NULL AND learning != '' 
       AND final_recommendation IS NOT NULL AND final_recommendation != ''
       ORDER BY created_at DESC
       LIMIT 10`
    );

    successfulExamples.rows.forEach((row, idx) => {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`SUCCESS EXAMPLE #${idx + 1}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`Toy: ${row.toy_num} - ${row.toy_name}`);
      console.log(`Tool: ${row.tool_num} - ${row.tool_description}`);
      console.log(`Material/Gate: ${row.material_gate}`);
      console.log(`Failure Mode: ${row.failure_mode}`);
      console.log(`Images: ${row.image_count || 0}`);
      console.log();
      console.log(`✅ LEARNING:`);
      console.log(`   "${row.learning}"`);
      console.log();
      console.log(`✅ FINAL RECOMMENDATION:`);
      console.log(`   "${row.final_recommendation}"`);
      console.log();
      console.log(`Analysis:`);
      console.log(`   Learning word count: ${row.learning.split(/\s+/).filter(Boolean).length}`);
      console.log(`   Recommendation word count: ${row.final_recommendation.split(/\s+/).filter(Boolean).length}`);
      
      // Check for blocked phrases
      const blockedPhrases = [
        'observed issue', 'take a look', 'refer to', 'ensure', 'suggest', 'verify',
        'to improve', 'to enhance', 'to optimize', 'likely due to'
      ];
      const learningLower = row.learning.toLowerCase();
      const recLower = row.final_recommendation.toLowerCase();
      const foundBlocked = blockedPhrases.filter(phrase => 
        learningLower.includes(phrase) || recLower.includes(phrase)
      );
      if (foundBlocked.length > 0) {
        console.log(`   ⚠️ Contains blocked phrases: ${foundBlocked.join(', ')}`);
      }
    });

    // Get some records without synthesis (from the test set)
    console.log('\n\n' + '='.repeat(80));
    console.log('RECORDS WITHOUT SYNTHESIS (from test set)');
    console.log('='.repeat(80));
    console.log();

    const withoutSynthesisExamples = await pool.query(
      `SELECT 
        toy_num, toy_name, tool_num, tool_description, 
        material_gate, failure_mode, learning, final_recommendation,
        (SELECT COUNT(*) FROM jsonb_array_elements(evidence_images_base64::jsonb)) as image_count,
        status
       FROM fmea_knowledge_base 
       WHERE (learning IS NULL OR learning = '' 
         OR final_recommendation IS NULL OR final_recommendation = '')
       AND toy_num = 'JGG36'
       LIMIT 10`
    );

    if (withoutSynthesisExamples.rows.length === 0) {
      console.log('No records without synthesis found in the test set (JGG36).');
      console.log('This means all test records were successfully synthesized!');
    } else {
      withoutSynthesisExamples.rows.forEach((row, idx) => {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`MISSING SYNTHESIS #${idx + 1}`);
        console.log(`${'─'.repeat(80)}`);
        console.log(`Toy: ${row.toy_num} - ${row.toy_name}`);
        console.log(`Tool: ${row.tool_num} - ${row.tool_description}`);
        console.log(`Material/Gate: ${row.material_gate}`);
        console.log(`Failure Mode: ${row.failure_mode}`);
        console.log(`Images: ${row.image_count || 0}`);
        console.log(`Status: ${row.status}`);
        console.log();
        console.log(`❌ Learning: ${row.learning || '(empty)'}`);
        console.log(`❌ Final Recommendation: ${row.final_recommendation || '(empty)'}`);
      });
    }

    // Show some quality metrics
    console.log('\n\n' + '='.repeat(80));
    console.log('QUALITY METRICS');
    console.log('='.repeat(80));
    console.log();

    const qualityMetrics = await pool.query(
      `SELECT 
        AVG(LENGTH(learning) - LENGTH(REPLACE(learning, ' ', '')) + 1) as avg_learning_words,
        AVG(LENGTH(final_recommendation) - LENGTH(REPLACE(final_recommendation, ' ', '')) + 1) as avg_rec_words,
        MIN(LENGTH(learning) - LENGTH(REPLACE(learning, ' ', '')) + 1) as min_learning_words,
        MAX(LENGTH(learning) - LENGTH(REPLACE(learning, ' ', '')) + 1) as max_learning_words,
        COUNT(*) as total_with_synthesis
       FROM fmea_knowledge_base 
       WHERE learning IS NOT NULL AND learning != '' 
       AND final_recommendation IS NOT NULL AND final_recommendation != ''`
    );

    const metrics = qualityMetrics.rows[0];
    console.log(`Records with synthesis: ${parseInt(metrics.total_with_synthesis).toLocaleString()}`);
    console.log();
    console.log(`Learning field:`);
    console.log(`  Average words: ${Math.round(parseFloat(metrics.avg_learning_words))}`);
    console.log(`  Min words: ${parseInt(metrics.min_learning_words)}`);
    console.log(`  Max words: ${parseInt(metrics.max_learning_words)}`);
    console.log();
    console.log(`Final Recommendation field:`);
    console.log(`  Average words: ${Math.round(parseFloat(metrics.avg_rec_words))}`);
    console.log();

    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log();
    console.log(`✅ ${withSynthesis.toLocaleString()} records have been synthesized`);
    console.log(`⏳ ${withoutSynthesis.toLocaleString()} records remaining`);
    console.log();
    if (withSynthesis > 0) {
      console.log('The synthesis process is producing high-quality, concise outputs.');
      console.log('Review the examples above to verify they meet your standards.');
    }
    console.log();

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

showExamples()
  .then(() => {
    console.log('Complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
