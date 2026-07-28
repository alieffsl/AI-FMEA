/**
 * Analyze Skipped Records from Test Run
 * 
 * This script will:
 * 1. Re-run the 4 skipped records with detailed logging
 * 2. Show what validation errors occurred
 * 3. Display the generated output that failed validation
 * 4. Show some successful examples for comparison
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { 
  buildUserPrompt, 
  parseSynthesis, 
  validateSynthesis 
} from './synthesize_all_openai.ts';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// -----------------------------------------------------------------------------
// Types (copied from main script)
// -----------------------------------------------------------------------------

interface RawEntry {
  text?: string | null;
  img?: string | null;
}

interface FirstShotEntry {
  finding?: string | null;
  img?: string | null;
}

interface NextShotEntry {
  finding?: string | null;
  recommendation?: string | null;
  img?: string | null;
}

interface FMEARecord {
  failureId: number;
  toyNum?: string | null;
  toyName?: string | null;
  toolNum?: string | null;
  toolDescription?: string | null;
  materialGate?: string | null;
  failureMode?: string | null;
  status?: string | null;
  initialRecommendations?: RawEntry[] | null;
  firstShot?: FirstShotEntry[] | null;
  firstShotActions?: RawEntry[] | null;
  nextShot?: NextShotEntry[] | null;
}

interface SynthesisResult {
  learning: string;
  final_recommendation: string;
}

interface ImageBase64Entry {
  data: string;
  size?: number;
  filename?: string;
  mimeType: string;
}

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_IMAGES = Number.parseInt(process.env.MAX_IMAGES ?? '5', 10);
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.MAX_OUTPUT_TOKENS ?? '600', 10);
const IMAGE_DETAIL = process.env.IMAGE_DETAIL === 'high' ? 'high' : 'low';

type ImageDetail = 'low' | 'high' | 'auto';

// -----------------------------------------------------------------------------
// System prompt
// -----------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior plastic component design engineer writing FMEA learning notes for future checklist creation.

Return only a valid JSON object with exactly two keys:
{"learning":"...","final_recommendation":"..."}

No markdown. No preamble. No extra keys.

Purpose:
The output will be used later to build checklists of repeated concerns by failure mode and tool description.
Write notes that are natural for engineers to read, but consistent enough to reuse as checklist knowledge.

Your job:
Read trial logs, MEC comments, and inspection images, then extract the useful plastic-part concern and the final physical action.

Evidence priority:
1. Inspection images
2. Shot findings and applied actions
3. MEC comments only when they contain a concrete engineering decision, physical constraint, measurement, tooling action, material decision, assembly result, or lab result
4. Initial recommendations

Use only physical plastic-part evidence:
fit, interference, clearance, wall thickness, ribs, bosses, screw bosses, snap fit, gate, gate vestige, parting line, flash, texture, draft, radius, sharp edge, lead-in, material, tooling, CNC, demold, assembly, and lab result.

Do not infer generic molding causes from material, gate type, or failure mode alone.
Do not invent root cause, process settings, benefits, or test results.
If text conflicts with images, trust the images.

Before writing, ignore:
- Reference-only comments such as "take a look", "refer to", "see", "check", "as per", "follow comment", "below", "above", "image", "photo", "tab", or "file"
- Acknowledgements such as "ok", "okay", "noted", "roger", "will do", "will check", "understood", "good", or "thanks"
- Pending-only comments such as "checking", "to confirm", "waiting", "under review", "MEC review", or "will update"
- Bare ownership, handoff, or conversational filler

Field separation:
- "learning" and "final_recommendation" must not say the same thing.
- "learning" records the reusable engineering concern: what issue happened, where it happened, and what physical condition caused or contributed to it.
- "final_recommendation" records the final plastic-design, tooling, material, or assembly action only.
- Do not write the same action in both fields unless there is no other useful engineering concern available.
- Do not repeat the full defect description inside final_recommendation unless needed to identify the action area.

learning rules:
- Write 1-2 natural engineering sentences.
- Aim for 30-60 words total.
- Start with the reusable concern, not the project, toy, component, material, or status.
- Make the note useful for a future checklist.
- Use human engineering wording, not clipped labels and not a formal report.
- Include the defect, affected area, physical driver, constraint, or confirmed result when available.
- Include the corrective action only when needed to make the learning understandable.
- If the action is already clear in final_recommendation, focus learning on the concern instead.
- Include exact measurements or named dimensions only when they directly support the concern or action.
- If a result is recorded, include it naturally.
- If no result is recorded, do not mention that the result is missing.
- Do not write missing-data disclaimers.
- Do not narrate a timeline with "first", "then", or "next".
- Do not explain general injection-molding theory.
- Do not overstate certainty. If the source only shows association, use "was linked to", "was found with", or "was seen at" instead of "caused by".

Preferred concern wording:
- sharp edge caused white mark risk
- insufficient clearance affected assembly
- tight interference caused poor fit
- lead-in created aesthetic concern
- gate vestige affected appearance
- thin wall created weak area
- insufficient draft affected demold
- boss area needed reinforcement
- material was too hard for sharp-point area
- parting-line flash affected fit or appearance
- rib or boss geometry created interference

final_recommendation rules:
- Write one natural command sentence.
- Start with one imperative verb: Add, Reduce, Increase, Remove, Apply, Machine, Adjust, Replace, Relocate, Modify, Include, Set, Change, Update, or Revise.
- Use the actual recorded tooling, plastic-design, material, or assembly action.
- Include exact dimensions where available.
- Do not include rationale, background, result, checklist wording, or verification steps.
- Do not write "suggest", "ensure", "verify", "improve", "enhance", "optimize", or "facilitate".
- If no physical corrective action is recorded, write: "No corrective action recorded."

Dimension logic:
- If the text verb conflicts with the dimension change, trust the dimension.
- 0.1 mm to 0.3 mm means Increase.
- 0.3 mm to 0.1 mm means Reduce.

Good examples:
{"learning":"White mark was seen at the sharp inner edge, where the part was prone to scratching during demold.","final_recommendation":"Add radius to the sharp inner edge."}
{"learning":"The inner wall had insufficient draft for clean demold, creating white mark risk on the core side.","final_recommendation":"Add draft to the inner wall."}
{"learning":"The shoe tip remained too sharp with PVC90, making material hardness a concern for soft sharp-point areas.","final_recommendation":"Replace PVC90 with PVC75."}
{"learning":"The middle step clearance was too small for stable assembly at 0.1 mm.","final_recommendation":"Increase middle step clearance from 0.1 mm to 0.3 mm."}
{"learning":"The lead-in created an aesthetic concern at the joint area.","final_recommendation":"Remove the lead-in from the affected joint."}
{"learning":"The hole and boss area had an assembly concern around the screw attachment.","final_recommendation":"Add KD to the hole-boss screw area."}

Bad examples:
{"learning":"The Doll Base Top for BARBIE KEN X KARL LAGERFELD failed during first shot due to injection molding problems.","final_recommendation":"Adjust injection speed to optimize material flow."}
{"learning":"Radius was added to the sharp edge.","final_recommendation":"Add radius to the sharp edge."}
{"learning":"Observed issue: White Mark. Intermediate evaluations: Take a look on the FS comment.","final_recommendation":"Suggest adding draft to avoid scratched potential sticking core leads to white mark."}
{"learning":"This adjustment is critical to improve assembly integrity and ensure proper function.","final_recommendation":"Add KD at the hole to enhance assembly integrity."}

Fallback:
- If there is a useful defect or concern but no physical action, write the concern naturally in "learning" and use: "final_recommendation":"No corrective action recorded."
- If there is no useful defect, cause, action, dimension, image evidence, or result, return: {"learning":"No useful technical detail recorded.","final_recommendation":"No corrective action recorded."}`;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function safe(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function recordKey(record: FMEARecord): { toyNum: string; toolNum: string; failureMode: string } {
  return {
    toyNum: safe(record.toyNum) || 'Unknown',
    toolNum: safe(record.toolNum) || 'Unknown',
    failureMode: safe(record.failureMode) || 'Unknown',
  };
}

function buildVisionParts(images: ImageBase64Entry[]): any[] {
  const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  
  function normalizeMimeType(mime: string): string {
    const cleaned = safe(mime).toLowerCase();
    if (cleaned === 'image/jfif' || cleaned === 'image/jpg') return 'image/jpeg';
    return cleaned;
  }

  return images
    .filter(img => safe(img.data).length > 0)
    .filter(img => SUPPORTED_MIME.has(normalizeMimeType(img.mimeType)))
    .slice(0, MAX_IMAGES)
    .map(img => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${normalizeMimeType(img.mimeType)};base64,${img.data}`,
        detail: IMAGE_DETAIL as ImageDetail,
      },
    }));
}

function stripJsonFences(content: string): string {
  return safe(content)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

// -----------------------------------------------------------------------------
// Main Analysis
// -----------------------------------------------------------------------------

async function analyzeSkippedRecords() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  
  const pool = new Pool({
    host: process.env.PG_HOST!,
    port: Number.parseInt(process.env.PG_PORT ?? '5432', 10),
    user: process.env.PG_USER!,
    password: process.env.PG_PASSWORD!,
    database: process.env.PG_DATABASE!,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  try {
    console.log('='.repeat(80));
    console.log('ANALYZING SKIPPED RECORDS FROM TEST RUN');
    console.log('='.repeat(80));
    console.log();

    // Load raw records
    const filePath = path.join(__dirname, 'raw_fmea_data.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const allRecords = JSON.parse(raw) as FMEARecord[];
    
    // Get first 50 for test (same as test run)
    const testRecords = allRecords.slice(0, 50);

    console.log(`Loaded ${testRecords.length} test records\n`);

    // Process each record and collect results
    const results: Array<{
      record: FMEARecord;
      hasImages: boolean;
      rawOutput: string;
      parsed: SynthesisResult | null;
      validationErrors: string[];
      success: boolean;
    }> = [];

    for (let i = 0; i < testRecords.length; i++) {
      const record = testRecords[i];
      const { toyNum, toolNum, failureMode } = recordKey(record);
      const label = `[${i + 1}/${testRecords.length}] ${toyNum} / ${toolNum} / ${failureMode}`;

      try {
        // Get images from DB
        const { rows } = await pool.query<{
          evidence_images_base64: ImageBase64Entry[] | null;
        }>(
          `SELECT evidence_images_base64
           FROM fmea_knowledge_base
           WHERE toy_num = $1 AND tool_num = $2 AND failure_mode = $3
           LIMIT 1`,
          [toyNum, toolNum, failureMode]
        );

        if (rows.length === 0) continue;

        const images = rows[0].evidence_images_base64 ?? [];
        const visionParts = buildVisionParts(images);
        
        const userContent = [
          { type: 'text', text: buildUserPrompt(record) },
          ...visionParts,
        ];

        // Call OpenAI
        const response = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'fmea_synthesis',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  learning: {
                    type: 'string',
                    description: 'Natural engineer note describing the reusable physical concern.',
                  },
                  final_recommendation: {
                    type: 'string',
                    description: 'One final physical action command.',
                  },
                },
                required: ['learning', 'final_recommendation'],
              },
            },
          } as any,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent as any },
          ],
        });

        const rawOutput = response.choices[0]?.message?.content ?? '';
        const parsed = parseSynthesis(stripJsonFences(rawOutput));
        const validationErrors = parsed ? validateSynthesis(parsed, record) : ['Failed to parse JSON'];

        results.push({
          record,
          hasImages: images.length > 0,
          rawOutput,
          parsed,
          validationErrors,
          success: parsed !== null && validationErrors.length === 0,
        });

        console.log(`${label} - ${validationErrors.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
      } catch (err: any) {
        console.error(`${label} - ERROR: ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS RESULTS');
    console.log('='.repeat(80));
    console.log();

    const skipped = results.filter(r => !r.success);
    const successful = results.filter(r => r.success);

    console.log(`Total processed: ${results.length}`);
    console.log(`Successful: ${successful.length} (${Math.round(successful.length / results.length * 100)}%)`);
    console.log(`Skipped: ${skipped.length} (${Math.round(skipped.length / results.length * 100)}%)`);
    console.log();

    // Show skipped records in detail
    console.log('='.repeat(80));
    console.log('DETAILED ANALYSIS OF SKIPPED RECORDS');
    console.log('='.repeat(80));
    console.log();

    skipped.forEach((result, idx) => {
      const { record, hasImages, rawOutput, parsed, validationErrors } = result;
      const { toyNum, toolNum, failureMode } = recordKey(record);

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`SKIPPED RECORD #${idx + 1}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`Toy: ${toyNum} - ${safe(record.toyName)}`);
      console.log(`Tool: ${toolNum} - ${safe(record.toolDescription)}`);
      console.log(`Material/Gate: ${safe(record.materialGate)}`);
      console.log(`Failure Mode: ${failureMode}`);
      console.log(`Has Images: ${hasImages ? 'Yes' : 'No'}`);
      console.log();

      console.log('VALIDATION ERRORS:');
      validationErrors.forEach(err => console.log(`  ❌ ${err}`));
      console.log();

      if (parsed) {
        console.log('GENERATED OUTPUT (that failed validation):');
        console.log(`  Learning: "${parsed.learning}"`);
        console.log(`  Final Recommendation: "${parsed.final_recommendation}"`);
        console.log();
        console.log(`  Learning word count: ${parsed.learning.split(/\s+/).filter(Boolean).length}`);
        console.log(`  Recommendation word count: ${parsed.final_recommendation.split(/\s+/).filter(Boolean).length}`);
      } else {
        console.log('RAW OUTPUT (failed to parse):');
        console.log(rawOutput.slice(0, 500));
      }
      console.log();

      console.log('SOURCE DATA:');
      console.log(`  Initial Recommendations: ${(record.initialRecommendations ?? []).length} items`);
      console.log(`  First Shot: ${(record.firstShot ?? []).length} items`);
      console.log(`  First Shot Actions: ${(record.firstShotActions ?? []).length} items`);
      console.log(`  Next Shot: ${(record.nextShot ?? []).length} items`);
    });

    // Show successful examples
    console.log('\n\n' + '='.repeat(80));
    console.log('SUCCESSFUL OUTPUT EXAMPLES (for comparison)');
    console.log('='.repeat(80));
    console.log();

    const successfulSample = successful.slice(0, 5);
    successfulSample.forEach((result, idx) => {
      const { record, hasImages, parsed } = result;
      const { toyNum, toolNum, failureMode } = recordKey(record);

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`SUCCESS EXAMPLE #${idx + 1}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`Toy: ${toyNum} - ${safe(record.toyName)}`);
      console.log(`Tool: ${toolNum} - ${safe(record.toolDescription)}`);
      console.log(`Failure Mode: ${failureMode}`);
      console.log(`Has Images: ${hasImages ? 'Yes' : 'No'}`);
      console.log();

      if (parsed) {
        console.log('✅ SUCCESSFUL OUTPUT:');
        console.log(`  Learning: "${parsed.learning}"`);
        console.log(`  Final Recommendation: "${parsed.final_recommendation}"`);
        console.log();
        console.log(`  Learning word count: ${parsed.learning.split(/\s+/).filter(Boolean).length}`);
        console.log(`  Recommendation word count: ${parsed.final_recommendation.split(/\s+/).filter(Boolean).length}`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log();
    console.log('Validation is working as designed:');
    console.log(`- ${successful.length}/${results.length} records passed quality checks`);
    console.log(`- ${skipped.length}/${results.length} records rejected for quality issues`);
    console.log();
    console.log('Review the skipped records above to decide:');
    console.log('1. Keep current validation (recommended) - quality over quantity');
    console.log('2. Adjust specific validation rules if they are too strict');
    console.log('3. Improve source data quality for better results');
    console.log();

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the analysis
analyzeSkippedRecords()
  .then(() => {
    console.log('Analysis complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Analysis failed:', err);
    process.exit(1);
  });
