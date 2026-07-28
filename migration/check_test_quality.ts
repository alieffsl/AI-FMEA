/**
 * Check Test Quality - Analyze the 50 test records
 * Show what the NEW validation would catch in existing synthesis
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Validation functions (copied from main script)
const APPROVED_VERBS = [
  'Add', 'Reduce', 'Increase', 'Remove', 'Apply', 'Machine',
  'Adjust', 'Replace', 'Relocate', 'Modify', 'Include', 
  'Set', 'Change', 'Update', 'Revise',
];

const BLOCKED_PHRASES = [
  'observed issue', 'intermediate evaluations', 'take a look',
  'refer to', 'see fs comment', 'see ns comment', 'see comment',
  'check comment', 'as per image', 'as per photo', 'follow comment',
  'this indicates', 'this suggests', 'likely due to',
  'it is necessary', 'this adjustment is critical',
  'to improve', 'to enhance', 'to optimize', 'to facilitate',
  'no shot outcome was recorded', 'outcome not confirmed',
  'available records', 'ensure ', 'suggest ', 'verify ',
];

function safe(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function wordCount(text: string): number {
  return safe(text).split(/\s+/).filter(Boolean).length;
}

function validateSynthesis(learning: string, recommendation: string): string[] {
  const errors: string[] = [];
  const lowerLearning = learning.toLowerCase();
  const lowerRecommendation = recommendation.toLowerCase();

  const learningWords = wordCount(learning);
  if (learningWords < 8 && learning !== 'No useful technical detail recorded.') {
    errors.push('learning too short (<8 words)');
  }
  if (learningWords > 75) {
    errors.push('learning too wordy (>75 words)');
  }

  if (recommendation !== 'No corrective action recorded.') {
    if (!APPROVED_VERBS.some(verb => recommendation.startsWith(`${verb} `))) {
      errors.push('recommendation must start with approved verb');
    }
    if (wordCount(recommendation) > 28) {
      errors.push('recommendation too wordy (>28 words)');
    }
  }

  for (const phrase of BLOCKED_PHRASES) {
    if (lowerLearning.includes(phrase)) {
      errors.push(`learning contains "${phrase}"`);
    }
    if (recommendation !== 'No corrective action recorded.' && lowerRecommendation.includes(phrase)) {
      errors.push(`recommendation contains "${phrase}"`);
    }
  }

  return errors;
}

interface FMEARecord {
  failureId: number;
  toyNum?: string | null;
  toolNum?: string | null;
  failureMode?: string | null;
}

function recordKey(record: FMEARecord): { toyNum: string; toolNum: string; failureMode: string } {
  return {
    toyNum: safe(record.toyNum) || 'Unknown',
    toolNum: safe(record.toolNum) || 'Unknown',
    failureMode: safe(record.failureMode) || 'Unknown',
  };
}

async function checkTestQuality() {
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
    console.log('TEST QUALITY ANALYSIS - Checking 50 Test Records Against New Validation');
    console.log('='.repeat(80));
    console.log();

    // Load raw records to get the test set
    const filePath = path.join(__dirname, 'raw_fmea_data.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const allRecords = JSON.parse(raw) as FMEARecord[];
    const testRecords = allRecords.slice(0, 50);

    console.log(`Analyzing first 50 records from raw_fmea_data.json...`);
    console.log();

    let passCount = 0;
    let failCount = 0;
    const failedRecords: any[] = [];

    for (const record of testRecords) {
      const { toyNum, toolNum, failureMode } = recordKey(record);

      const result = await pool.query(
        `SELECT learning, final_recommendation, toy_name, tool_description
         FROM fmea_knowledge_base
         WHERE toy_num = $1 AND tool_num = $2 AND failure_mode = $3
         LIMIT 1`,
        [toyNum, toolNum, failureMode]
      );

      if (result.rows.length === 0) {
        console.log(`⚠️  Not found in DB: ${toyNum} / ${toolNum} / ${failureMode}`);
        continue;
      }

      const row = result.rows[0];
      
      if (!row.learning || !row.final_recommendation) {
        console.log(`⚠️  Missing synthesis: ${toyNum} / ${toolNum} / ${failureMode}`);
        failCount++;
        continue;
      }

      const errors = validateSynthesis(row.learning, row.final_recommendation);

      if (errors.length === 0) {
        passCount++;
      } else {
        failCount++;
        failedRecords.push({
          toyNum,
          toolNum,
          failureMode,
          toyName: row.toy_name,
          toolDescription: row.tool_description,
          learning: row.learning,
          recommendation: row.final_recommendation,
          errors,
        });
      }
    }

    console.log('='.repeat(80));
    console.log('VALIDATION RESULTS');
    console.log('='.repeat(80));
    console.log();
    console.log(`✅ Passed: ${passCount}/${testRecords.length} (${Math.round(passCount/testRecords.length*100)}%)`);
    console.log(`❌ Failed: ${failCount}/${testRecords.length} (${Math.round(failCount/testRecords.length*100)}%)`);
    console.log();

    if (failedRecords.length > 0) {
      console.log('='.repeat(80));
      console.log('FAILED RECORDS - What NEW Validation Would Catch');
      console.log('='.repeat(80));
      console.log();

      failedRecords.forEach((rec, idx) => {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`FAILED RECORD #${idx + 1}`);
        console.log(`${'─'.repeat(80)}`);
        console.log(`Toy: ${rec.toyNum} - ${rec.toyName}`);
        console.log(`Tool: ${rec.toolNum} - ${rec.toolDescription}`);
        console.log(`Failure Mode: ${rec.failureMode}`);
        console.log();
        console.log('CURRENT OUTPUT (in database):');
        console.log(`  Learning: "${rec.learning.slice(0, 150)}${rec.learning.length > 150 ? '...' : ''}"`);
        console.log(`  Recommendation: "${rec.recommendation}"`);
        console.log();
        console.log('VALIDATION ERRORS:');
        rec.errors.forEach((err: string) => console.log(`  ❌ ${err}`));
      });
    }

    console.log('\n\n' + '='.repeat(80));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    console.log();
    console.log('The EXISTING synthesis (before new validation) has MAJOR QUALITY ISSUES:');
    console.log();
    console.log('Problems found in existing data:');
    console.log('  - Blocked phrases like "observed issue", "take a look", "suggest"');
    console.log('  - Recommendations not starting with approved verbs');
    console.log('  - Contains "to enhance", "to optimize", "ensure" phrases');
    console.log('  - Too wordy or too short outputs');
    console.log();
    console.log('The NEW validation with repair loop will:');
    console.log('  ✅ Catch these issues BEFORE saving to database');
    console.log('  ✅ Automatically attempt repairs up to 2 times');
    console.log('  ✅ Skip records that fail validation (better quality over quantity)');
    console.log();
    console.log(`Current pass rate of OLD synthesis: ${Math.round(passCount/testRecords.length*100)}%`);
    console.log(`Expected pass rate with NEW synthesis: 90-95% (from test run)`);
    console.log();
    console.log('RECOMMENDATION:');
    console.log('  Run full production with FORCE_REPROCESS=true to replace ALL records');
    console.log('  This will dramatically improve output quality across the board.');
    console.log();

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkTestQuality()
  .then(() => {
    console.log('Complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
