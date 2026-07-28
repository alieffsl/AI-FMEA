/**
 * FMEA Historical Checklist Generation Pipeline
 * 
 * Consolidates knowledge base learnings into reusable checklist entries
 * using OpenAI to identify distinct sub-concerns per (tool_description × failure_mode)
 */

import pg from 'pg';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const FORCE_REPROCESS = process.env.FORCE_REPROCESS === 'true';
const TEST_MODE = process.env.TEST_MODE === 'true';
const TEST_SIZE = parseInt(process.env.TEST_SIZE ?? '10');

const poolConfig = {
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
  max: 10, // Maximum pool size
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection not available
};

let pool = new pg.Pool(poolConfig);

// Recreate pool on error
pool.on('error', (err) => {
  console.error('[Pool] Unexpected error on idle client', err);
  pool = new pg.Pool(poolConfig);
});

type SubConcern = {
  concern: string;
  recommendation: string;
  supporting_indices: number[];
};

type LearningRecord = {
  id: string;
  failure_id: number;
  learning: string;
  final_recommendation: string;
};

type ChecklistGroup = {
  tool_description_normalized: string;
  tool_category: string | null;
  failure_mode: string;
  records: LearningRecord[];
};

const CONSOLIDATION_PROMPT = `You are an FMEA engineering expert. You will receive multiple learnings about the same failure mode on the same tool/part. Your job is to consolidate them into the SMALLEST possible set of distinct, non-redundant checklist entries.

GROUPING RULE:
Two learnings belong in the SAME group if they describe the SAME underlying physical mechanism, even if:
- The wording is different
- The project names are different
- The exact dimensions vary slightly
- One is more specific than the other

Two learnings belong in DIFFERENT groups ONLY if:
- They describe different physical root causes (e.g., "insufficient draft" vs "sink marks")
- They affect different physical features/areas of the part
- Fixing one would NOT fix the other

CRITICAL: Your goal is AGGRESSIVE CONSOLIDATION. If you output more than 3 entries, you are probably splitting things that should be merged. Most failure modes have 1-2 true root causes, not 5-10.

STEP 1 — Identify TRUE root causes:
- Read ALL learnings first
- Identify the 1-3 DISTINCT physical mechanisms causing this failure mode
- Assign ALL learnings to one of these root causes (most learnings will share the same root cause)

STEP 2 — Write ONE entry per root cause:
- concern: One concise sentence describing the root cause mechanism. Use engineering language, not project-specific details. Example: "Insufficient draft causes core sticking and visible marks during demold" NOT "The Doll Base Top had a white mark near the hinge and the Bracelet had scratches"
- recommendation: One short imperative sentence starting with action verb (Add/Reduce/Increase/Remove/Modify/Review). Be specific. If dimensions are mentioned, use the most conservative value.
- supporting_indices: ALL learning indices that share this root cause

QUALITY CHECKS (apply before returning):
1. If you have 4+ entries, re-read them — can any be merged because they describe the same mechanism?
2. If two "concern" sentences sound similar or use similar technical words, merge them
3. If two "recommendation" sentences suggest the same action, merge them
4. Your output should have FEWER entries than input learnings (ideally 1/3 to 1/2 as many)

WORKED EXAMPLE:
Input (4 learnings):
0: "White mark near the hinge, insufficient draft on the core."
1: "Scratch marks on demold, core sticking, draft angle too shallow."
2: "Rough surface texture on the outer face, visible under light."
3: "Surface finish inconsistent, sink marks near the gate."

Correct output (2 entries, not 4):
[
  { "concern": "Insufficient draft on core surfaces causes sticking and visible marks during demold.", "recommendation": "Add 0.5 degree minimum draft to all core surfaces.", "supporting_indices": [0, 1] },
  { "concern": "Inconsistent surface finish and sink marks near the gate.", "recommendation": "Review wall thickness and cooling near the gate to reduce sink marks.", "supporting_indices": [2, 3] }
]

Return ONLY the JSON array:
[
  {
    "concern": "...",
    "recommendation": "...",
    "supporting_indices": [0, 1, 2]
  }
]`;

async function consolidateLearnings(
  group: ChecklistGroup
): Promise<SubConcern[]> {
  const learningsText = group.records
    .map((r, idx) => `[${idx}] Learning: ${r.learning}\nRecommendation: ${r.final_recommendation}`)
    .join('\n\n');

  const userPrompt = `Tool: ${group.tool_description_normalized}${group.tool_category ? ` (${group.tool_category})` : ''}
Failure Mode: ${group.failure_mode}
Total Learnings: ${group.records.length}

${learningsText}

Consolidate these into distinct checklist concerns. Return JSON array.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: CONSOLIDATION_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  // Parse JSON
  const cleaned = content.replace(/^```json\n?/i, '').replace(/\n?```$/i, '');
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Response is not an array');
  }

  return parsed as SubConcern[];
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

async function getGroupsToProcess(): Promise<ChecklistGroup[]> {
  console.log('[Pipeline] Querying (tool_description_normalized × failure_mode) groups...');

  const query = `
    SELECT 
      tool_description_normalized,
      tool_category,
      failure_mode,
      COUNT(*) as record_count
    FROM fmea_knowledge_base
    WHERE tool_description_normalized IS NOT NULL
      AND failure_mode IS NOT NULL
      AND learning IS NOT NULL
      AND final_recommendation IS NOT NULL
      AND learning != ''
      AND final_recommendation != ''
    GROUP BY tool_description_normalized, tool_category, failure_mode
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
  `;

  let result;
  try {
    result = await pool.query<{
      tool_description_normalized: string;
      tool_category: string | null;
      failure_mode: string;
      record_count: number;
    }>(query);
  } catch (err: any) {
    console.error('[Pipeline] Query error, recreating pool...', err.message);
    pool = new pg.Pool(poolConfig);
    result = await pool.query<{
      tool_description_normalized: string;
      tool_category: string | null;
      failure_mode: string;
      record_count: number;
    }>(query);
  }

  // Fetch records for each group separately
  const groups: ChecklistGroup[] = [];
  
  for (const row of result.rows) {
    const recordsQuery = `
      SELECT id, failure_id, learning, final_recommendation
      FROM fmea_knowledge_base
      WHERE tool_description_normalized = $1
        AND failure_mode = $2
        ${row.tool_category ? 'AND tool_category = $3' : ''}
    `;
    
    const params = row.tool_category 
      ? [row.tool_description_normalized, row.failure_mode, row.tool_category]
      : [row.tool_description_normalized, row.failure_mode];
    
    const recordsResult = await pool.query<LearningRecord>(recordsQuery, params);
    
    groups.push({
      tool_description_normalized: row.tool_description_normalized,
      tool_category: row.tool_category,
      failure_mode: row.failure_mode,
      records: recordsResult.rows,
    });
  }

  if (!FORCE_REPROCESS) {
    // Filter out groups that already have checklist entries
    const existing = await pool.query<{ tool_description_normalized: string; failure_mode: string }>(`
      SELECT DISTINCT tool_description_normalized, failure_mode
      FROM fmea_checklist
    `);

    const existingSet = new Set(
      existing.rows.map(r => `${r.tool_description_normalized}||${r.failure_mode}`)
    );

    return groups.filter(
      g => !existingSet.has(`${g.tool_description_normalized}||${g.failure_mode}`)
    );
  }

  return groups;
}

async function processGroup(group: ChecklistGroup, index: number, total: number) {
  console.log(`[${index + 1}/${total}] Processing: ${group.tool_description_normalized} / ${group.failure_mode} (${group.records.length} records)`);

  try {
    // Consolidate with OpenAI
    const subConcerns = await consolidateLearnings(group);
    console.log(`  → Generated ${subConcerns.length} sub-concerns`);

    // Insert into database
    for (let i = 0; i < subConcerns.length; i++) {
      const subConcern = subConcerns[i];
      
      // Generate embedding
      const embeddingText = `${group.tool_category || ''} ${group.tool_description_normalized} ${group.failure_mode}: ${subConcern.concern}`;
      const embedding = await generateEmbedding(embeddingText);

      // Get supporting record IDs
      const supportingRecords = subConcern.supporting_indices.map(idx => group.records[idx]);
      const supportingIds = supportingRecords.map(r => r.id);
      const supportingFailureIds = supportingRecords.map(r => r.failure_id);

      // Retry logic for database connection issues
      let retries = 5;
      while (retries > 0) {
        try {
          await pool.query(
            `INSERT INTO fmea_checklist (
              tool_description_normalized,
              tool_category,
              failure_mode,
              sub_concern_index,
              concern,
              recommendation,
              supporting_record_count,
              supporting_record_ids,
              supporting_failure_ids,
              embedding
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (tool_description_normalized, failure_mode, sub_concern_index)
            DO UPDATE SET
              concern = EXCLUDED.concern,
              recommendation = EXCLUDED.recommendation,
              supporting_record_count = EXCLUDED.supporting_record_count,
              supporting_record_ids = EXCLUDED.supporting_record_ids,
              supporting_failure_ids = EXCLUDED.supporting_failure_ids,
              embedding = EXCLUDED.embedding,
              updated_at = NOW()`,
            [
              group.tool_description_normalized,
              group.tool_category,
              group.failure_mode,
              i + 1,
              subConcern.concern,
              subConcern.recommendation,
              supportingRecords.length,
              supportingIds,
              supportingFailureIds,
              JSON.stringify(embedding),
            ]
          );
          break; // Success, exit retry loop
        } catch (dbErr: any) {
          retries--;
          if (retries === 0) throw dbErr;
          console.log(`  ⚠ DB connection issue, recreating pool and retrying... (${retries} left)`);
          pool = new pg.Pool(poolConfig);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    console.log(`  ✓ Inserted ${subConcerns.length} checklist entries`);
  } catch (error: any) {
    console.error(`  ✗ Error: ${error.message}`);
  }
}

async function runPipeline() {
  console.log('[Pipeline] Starting checklist generation...');
  console.log(`[Pipeline] Model: ${MODEL}`);
  console.log(`[Pipeline] Embedding: ${EMBEDDING_MODEL}`);
  console.log(`[Pipeline] Force reprocess: ${FORCE_REPROCESS}`);
  console.log(`[Pipeline] Test mode: ${TEST_MODE}`);
  console.log('');

  let groups = await getGroupsToProcess();
  console.log(`[Pipeline] Found ${groups.length} groups to process`);

  if (TEST_MODE) {
    groups = groups.slice(0, TEST_SIZE);
    console.log(`[Pipeline] TEST MODE: Processing first ${groups.length} groups`);
  }

  console.log('');

  for (let i = 0; i < groups.length; i++) {
    await processGroup(groups[i], i, groups.length);
    
    // Rate limiting
    if ((i + 1) % 10 === 0) {
      console.log(`  ... pausing for rate limit ...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('');
  console.log('============================================================');
  console.log('CHECKLIST GENERATION COMPLETE');
  console.log('============================================================');

  const stats = await pool.query(`
    SELECT 
      COUNT(DISTINCT (tool_description_normalized, failure_mode)) as unique_groups,
      COUNT(*) as total_entries,
      SUM(supporting_record_count) as total_supporting_records
    FROM fmea_checklist
  `);

  console.log(`Unique tool/failure groups: ${stats.rows[0].unique_groups}`);
  console.log(`Total checklist entries:    ${stats.rows[0].total_entries}`);
  console.log(`Total supporting records:   ${stats.rows[0].total_supporting_records}`);
  console.log('============================================================');

  await pool.end();
}

runPipeline().catch(err => {
  console.error('[Pipeline] Fatal error:', err);
  process.exit(1);
});
