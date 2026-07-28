/**
 * FMEA Knowledge Base - AI Synthesis via OpenAI Chat Completions API (Vision-Enhanced)
 *
 * Generates two fields per record:
 * - learning: reusable engineering concern for future checklist mining
 * - final_recommendation: final physical plastic-design/tooling/material command
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? '3', 10);
const MAX_IMAGES = Number.parseInt(process.env.MAX_IMAGES ?? '5', 10);
const RETRY_ATTEMPTS = Number.parseInt(process.env.RETRY_ATTEMPTS ?? '3', 10);
const RETRY_BASE_MS = Number.parseInt(process.env.RETRY_BASE_MS ?? '1500', 10);
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.MAX_OUTPUT_TOKENS ?? '600', 10);
const FORCE_REPROCESS = process.env.FORCE_REPROCESS === 'true';
const TEST_MODE = process.env.TEST_MODE === 'true';
const TEST_SIZE = Number.parseInt(process.env.TEST_SIZE ?? '50', 10);
const REPAIR_ATTEMPTS = Number.parseInt(process.env.REPAIR_ATTEMPTS ?? '1', 10);
const START_FROM_RECORD = Number.parseInt(process.env.START_FROM_RECORD ?? '1', 10);
const REPROCESS_SPECIFIC_IDS = process.env.REPROCESS_SPECIFIC_IDS === 'true';
const REPROCESS_IDS_FILE = process.env.REPROCESS_IDS_FILE ?? 'failure_ids_to_reprocess.json';

type ImageDetail = 'low' | 'high' | 'auto';

function getImageDetail(): ImageDetail {
  const value = process.env.IMAGE_DETAIL;
  if (value === 'low' || value === 'high' || value === 'auto') return value;
  return 'low';  // Default to 'low' for cost efficiency (85 tokens vs 765 tokens)
}

const IMAGE_DETAIL: ImageDetail = getImageDetail();

// -----------------------------------------------------------------------------
// Types
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

interface ProcessStats {
  updated: number;
  noImages: number;
  notFound: number;
  parseErrors: number;
  apiErrors: number;
  skippedByValidation: number;
}

type TextContentPart = {
  type: 'text';
  text: string;
};

type ImageContentPart = {
  type: 'image_url';
  image_url: {
    url: string;
    detail: ImageDetail;
  };
};

type ChatContentPart = TextContentPart | ImageContentPart;

// -----------------------------------------------------------------------------
// Structured output schema
// -----------------------------------------------------------------------------

const FMEA_RESPONSE_FORMAT = {
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
          description:
            'Natural engineer note describing the reusable physical concern for future FMEA checklist mining.',
        },
        final_recommendation: {
          type: 'string',
          description:
            'One final physical plastic-design, tooling, material, or assembly command.',
        },
      },
      required: ['learning', 'final_recommendation'],
    },
  },
} as const;

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
- CRITICAL: Never start with "Observed issue:" or "Intermediate evaluations:" - these are old data format patterns that must not appear in the output.
- CRITICAL: Do not copy verbatim text from old comments or recommendations - synthesize new content from the technical details.

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
{"learning":"Observed issue: FS no deformed. Added Cav#. Intermediate evaluations: Propose adding rib to accommodate.","final_recommendation":"Designer & ES would like to see the FS first, then team can decide."}
{"learning":"Observed issue: Unfunction. Intermediate evaluations: Open close is not good, please increase interference.","final_recommendation":"Open close is not good, please increase interference open-close."}
{"learning":"Observed issue: Sharp point.","final_recommendation":"Add more radius / add thickness by 0.5mm."}

Fallback:
- If there is a useful defect or concern but no physical action, write the concern naturally in "learning" and use: "final_recommendation":"No corrective action recorded."
- If there is no useful defect, cause, action, dimension, image evidence, or result, return: {"learning":"No useful technical detail recorded.","final_recommendation":"No corrective action recorded."}`;

// -----------------------------------------------------------------------------
// User prompt
// -----------------------------------------------------------------------------

function safe(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function cleanList(items: Array<string | null | undefined>): string[] {
  return items.map(safe).filter(Boolean);
}

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '-';
}

function buildUserPrompt(record: FMEARecord): string {
  const initialRecommendations = cleanList(
    (record.initialRecommendations ?? []).map(item => item.text)
  );

  const firstShotFindings = cleanList(
    (record.firstShot ?? []).map(item => item.finding)
  );

  const firstShotActions = cleanList(
    (record.firstShotActions ?? []).map(item => item.text)
  );

  const nextShotFindingsActions = cleanList(
    (record.nextShot ?? []).map(item => item.recommendation ?? item.finding)
  );

  return `CONTEXT ONLY - DO NOT REPEAT UNLESS NEEDED
Failure mode: ${safe(record.failureMode)}
Tool description: ${safe(record.toolDescription)}
Toy: ${safe(record.toyName)}
Material / gate: ${safe(record.materialGate)}
Status: ${safe(record.status)}

RECORDED EVIDENCE

Initial recommendations:
${bulletList(initialRecommendations)}

First shot findings:
${bulletList(firstShotFindings)}

First shot actions:
${bulletList(firstShotActions)}

Next shot findings / actions:
${bulletList(nextShotFindingsActions)}

Task:
Use the record evidence and attached inspection images to write one reusable engineering learning note and one final physical recommendation.

The learning should help build a future checklist for repeated concerns under the same failure mode or tool description.

Do not summarize the whole record.
Do not repeat metadata.
Do not explain missing information.
Do not invent root cause, action, result, or process setting.
Do not make "learning" and "final_recommendation" repeat the same information.

Return only this JSON:
{"learning":"...","final_recommendation":"..."}`;
}

function buildRepairPrompt(
  record: FMEARecord,
  previousOutput: SynthesisResult | null,
  rawOutput: string | null,
  validationErrors: string[]
): string {
  const previous = previousOutput
    ? JSON.stringify(previousOutput, null, 2)
    : safe(rawOutput).slice(0, 1200);

  return `${buildUserPrompt(record)}

Previous output:
${previous}

Fix these issues:
${validationErrors.map(error => `- ${error}`).join('\n')}

Rewrite the JSON only.
Keep the note natural, useful for future checklist creation, grounded in the provided evidence, and non-repetitive.`;
}

// -----------------------------------------------------------------------------
// Image helpers
// -----------------------------------------------------------------------------

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function normalizeMimeType(mime: string): string {
  const cleaned = safe(mime).toLowerCase();
  if (cleaned === 'image/jfif' || cleaned === 'image/jpg') return 'image/jpeg';
  return cleaned;
}

function buildVisionParts(images: ImageBase64Entry[]): ImageContentPart[] {
  return images
    .filter(img => safe(img.data).length > 0)
    .filter(img => SUPPORTED_MIME.has(normalizeMimeType(img.mimeType)))
    .slice(0, MAX_IMAGES)
    .map(img => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${normalizeMimeType(img.mimeType)};base64,${img.data}`,
        detail: IMAGE_DETAIL,
      },
    }));
}

// -----------------------------------------------------------------------------
// Retry wrapper
// -----------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label = '',
  maxAttempts = RETRY_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) throw err;

      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[Retry] ${label} - attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error('withRetry: unreachable');
}

// -----------------------------------------------------------------------------
// Parsing and validation
// -----------------------------------------------------------------------------

const APPROVED_VERBS = [
  'Add',
  'Reduce',
  'Increase',
  'Remove',
  'Apply',
  'Machine',
  'Adjust',
  'Replace',
  'Relocate',
  'Modify',
  'Include',
  'Set',
  'Change',
  'Update',
  'Revise',
];

const BLOCKED_PHRASES = [
  'observed issue',
  'intermediate evaluations',
  'take a look',
  'refer to',
  'see fs comment',
  'see ns comment',
  'see comment',
  'check comment',
  'as per image',
  'as per photo',
  'follow comment',
  'this indicates',
  'this suggests',
  'likely due to',
  'it is necessary',
  'this adjustment is critical',
  'to improve',
  'to enhance',
  'to optimize',
  'to facilitate',
  'no shot outcome was recorded',
  'outcome not confirmed',
  'available records',
  'ensure ',
  'suggest ',
  'verify ',
];

const LEARNING_FALLBACK = 'No useful technical detail recorded.';
const RECOMMENDATION_FALLBACK = 'No corrective action recorded.';

function stripJsonFences(content: string): string {
  return safe(content)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseSynthesis(content: string): SynthesisResult | null {
  try {
    const parsed = JSON.parse(stripJsonFences(content)) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj).sort();

    if (keys.length !== 2 || keys[0] !== 'final_recommendation' || keys[1] !== 'learning') {
      return null;
    }

    if (typeof obj.learning !== 'string' || typeof obj.final_recommendation !== 'string') {
      return null;
    }

    const learning = obj.learning.trim();
    const finalRecommendation = obj.final_recommendation.trim();

    if (!learning || !finalRecommendation) return null;

    return {
      learning,
      final_recommendation: finalRecommendation,
    };
  } catch {
    return null;
  }
}

function wordCount(text: string): number {
  return safe(text).split(/\s+/).filter(Boolean).length;
}

function normalizeForComparison(text: string): string[] {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'to',
    'of',
    'on',
    'in',
    'at',
    'for',
    'with',
    'from',
    'by',
    'was',
    'were',
    'is',
    'are',
    'be',
    'been',
    'being',
    'area',
    'part',
    'component',
  ]);

  return safe(text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !stopWords.has(word));
}

function similarityScore(a: string, b: string): number {
  const aWords = new Set(normalizeForComparison(a));
  const bWords = new Set(normalizeForComparison(b));

  if (aWords.size === 0 || bWords.size === 0) return 0;

  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap += 1;
  }

  return overlap / Math.min(aWords.size, bWords.size);
}


function validateSynthesis(s: SynthesisResult, record: FMEARecord): string[] {
  const errors: string[] = [];
  const learning = safe(s.learning);
  const recommendation = safe(s.final_recommendation);
  const lowerLearning = learning.toLowerCase();
  const lowerRecommendation = recommendation.toLowerCase();

  if (!learning) errors.push('learning is empty.');
  if (!recommendation) errors.push('final_recommendation is empty.');

  const learningWords = wordCount(learning);
  if (learning !== LEARNING_FALLBACK && learningWords < 8) {
    errors.push('learning is too short to be useful for future checklist creation.');
  }

  if (learningWords > 75) {
    errors.push('learning is too wordy.');
  }

  if (recommendation !== RECOMMENDATION_FALLBACK) {
    if (!APPROVED_VERBS.some(verb => recommendation.startsWith(`${verb} `))) {
      errors.push('final_recommendation must start with an approved imperative verb.');
    }

    if (wordCount(recommendation) > 28) {
      errors.push('final_recommendation is too wordy.');
    }
  }

  for (const phrase of BLOCKED_PHRASES) {
    if (lowerLearning.includes(phrase)) {
      errors.push(`learning contains blocked phrase: "${phrase}".`);
    }

    if (recommendation !== RECOMMENDATION_FALLBACK && lowerRecommendation.includes(phrase)) {
      errors.push(`final_recommendation contains blocked phrase: "${phrase}".`);
    }
  }

  const imperativeStart = new RegExp(`^(${APPROVED_VERBS.join('|')})\\b`, 'i');
  if (learning !== LEARNING_FALLBACK && imperativeStart.test(learning)) {
    errors.push('learning starts like a recommendation; learning should describe the reusable concern, not command the action.');
  }

  if (recommendation !== RECOMMENDATION_FALLBACK && similarityScore(learning, recommendation) > 0.72) {
    errors.push('learning and final_recommendation are too repetitive.');
  }

  const toyName = safe(record.toyName).toLowerCase();
  if (toyName.length > 8 && lowerLearning.includes(toyName)) {
    errors.push('learning repeats toy metadata instead of starting with the reusable concern.');
  }

  const reportOpeningRe = /^the .+\b(in|for)\b.+\b(failed|exhibited|showed|demonstrated|experienced)\b/i;
  if (reportOpeningRe.test(learning)) {
    errors.push('learning opens like a formal report and repeats structured metadata.');
  }

  return errors;
}

// -----------------------------------------------------------------------------
// OpenAI call and repair loop
// -----------------------------------------------------------------------------

async function callOpenAI(
  openai: OpenAI,
  content: ChatContentPart[],
  label: string
): Promise<string> {
  const response = await withRetry<any>(
    () =>
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: FMEA_RESPONSE_FORMAT as any,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: content as any },
        ],
      }),
    label
  );

  const choice = response.choices[0];
  if (!choice) throw new Error('OpenAI returned no choices.');
  if (choice.finish_reason === 'length') throw new Error('OpenAI response was truncated by max_tokens.');

  return choice.message?.content ?? '';
}

async function synthesizeRecord(
  record: FMEARecord,
  openai: OpenAI,
  baseUserContent: ChatContentPart[],
  visionParts: ImageContentPart[],
  label: string
): Promise<SynthesisResult | null> {
  let rawOutput = await callOpenAI(openai, baseUserContent, label);
  let parsed = parseSynthesis(rawOutput);

  let errors = parsed
    ? validateSynthesis(parsed, record)
    : ['model output was not valid JSON with exactly learning and final_recommendation.'];

  if (parsed && errors.length === 0) return parsed;

  for (let attempt = 1; attempt <= REPAIR_ATTEMPTS; attempt++) {
    console.warn(`[QA] ${label} - repair ${attempt}/${REPAIR_ATTEMPTS}: ${errors.join(' | ')}`);

    const repairPrompt = buildRepairPrompt(record, parsed, rawOutput, errors);
    const repairContent: ChatContentPart[] = [
      { type: 'text', text: repairPrompt },
      ...visionParts,
    ];

    rawOutput = await callOpenAI(openai, repairContent, `${label} repair-${attempt}`);
    parsed = parseSynthesis(rawOutput);

    errors = parsed
      ? validateSynthesis(parsed, record)
      : ['repair output was not valid JSON with exactly learning and final_recommendation.'];

    if (parsed && errors.length === 0) return parsed;
  }

  console.warn(`[QA] ${label} - skipped after failed validation: ${errors.join(' | ')}`);
  return null;
}

// -----------------------------------------------------------------------------
// Core: process one record
// -----------------------------------------------------------------------------

function recordKey(record: FMEARecord): { toyNum: string; toolNum: string; failureMode: string } {
  return {
    toyNum: safe(record.toyNum) || 'Unknown',
    toolNum: safe(record.toolNum) || 'Unknown',
    failureMode: safe(record.failureMode) || 'Unknown',
  };
}

async function processRecord(
  record: FMEARecord,
  openai: OpenAI,
  pool: pg.Pool,
  stats: ProcessStats
): Promise<void> {
  const { toyNum, toolNum, failureMode } = recordKey(record);
  const label = `failure-${record.failureId} (${toyNum} / ${toolNum} / ${failureMode})`;

  let images: ImageBase64Entry[] = [];
  let dbRecordId: string | null = null;

  try {
    const { rows } = await pool.query<{
      id: string;
      evidence_images_base64: ImageBase64Entry[] | null;
      toy_num: string;
      tool_num: string;
      failure_mode: string;
    }>(
      `SELECT id, evidence_images_base64, toy_num, tool_num, failure_mode
       FROM fmea_knowledge_base
       WHERE toy_num = $1 AND tool_num = $2 AND failure_mode = $3
       LIMIT 1`,
      [toyNum, toolNum, failureMode]
    );

    if (rows.length === 0) {
      stats.notFound++;
      console.warn(`[DB] ${label} - no matching DB row.`);
      return;
    }

    const dbRow = rows[0];
    dbRecordId = dbRow.id;

    if (dbRow.toy_num !== toyNum || dbRow.tool_num !== toolNum || dbRow.failure_mode !== failureMode) {
      console.error(
        `[FATAL MISMATCH] ${label}\nExpected: toy=${toyNum}, tool=${toolNum}, failure=${failureMode}\nGot: toy=${dbRow.toy_num}, tool=${dbRow.tool_num}, failure=${dbRow.failure_mode}`
      );
      stats.apiErrors++;
      return;
    }

    images = dbRow.evidence_images_base64 ?? [];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Error] DB image query failed for ${label}: ${message}`);
    stats.apiErrors++;
    return;
  }

  if (images.length === 0) stats.noImages++;

  const visionParts = buildVisionParts(images);
  const userContent: ChatContentPart[] = [
    { type: 'text', text: buildUserPrompt(record) },
    ...visionParts,
  ];

  let synthesis: SynthesisResult | null;
  try {
    synthesis = await synthesizeRecord(record, openai, userContent, visionParts, label);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Error] OpenAI synthesis failed for ${label}: ${message}`);
    stats.apiErrors++;
    return;
  }

  if (!synthesis) {
    stats.skippedByValidation++;
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE fmea_knowledge_base
       SET learning = $1, final_recommendation = $2
       WHERE id = $3 AND toy_num = $4 AND tool_num = $5 AND failure_mode = $6`,
      [synthesis.learning, synthesis.final_recommendation, dbRecordId, toyNum, toolNum, failureMode]
    );

    if ((result.rowCount ?? 0) === 0) {
      stats.notFound++;
      console.warn(`[DB] ${label} - update matched zero rows.`);
    } else {
      stats.updated++;
      if (stats.updated % 50 === 0) {
        console.log(
          `[Progress] Updated: ${stats.updated} | Text-only: ${stats.noImages} | Errors: ${stats.apiErrors + stats.parseErrors} | Skipped QA: ${stats.skippedByValidation}`
        );
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Error] DB UPDATE failed for ${label}: ${message}`);
    stats.apiErrors++;
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function loadRecords(): Promise<FMEARecord[]> {
  const filePath = path.join(__dirname, 'raw_fmea_data.json');
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as FMEARecord[];
}

async function getPendingRecords(pool: pg.Pool, allRecords: FMEARecord[]): Promise<FMEARecord[]> {
  // Check if we should reprocess specific failure IDs only
  if (REPROCESS_SPECIFIC_IDS) {
    try {
      const whitelistPath = path.join(__dirname, REPROCESS_IDS_FILE);
      const whitelist: number[] = JSON.parse(fsSync.readFileSync(whitelistPath, 'utf8'));
      console.warn(`[Run] REPROCESS_SPECIFIC_IDS is enabled - only processing ${whitelist.length} specific failure IDs`);
      console.warn(`[Run] Loading from file: ${REPROCESS_IDS_FILE}`);
      console.warn(`[Run] Target IDs: ${whitelist.slice(0, 20).join(', ')}${whitelist.length > 20 ? '...' : ''}`);
      return allRecords.filter(record => whitelist.includes(record.failureId));
    } catch (error) {
      console.error(`[Run] Failed to load ${REPROCESS_IDS_FILE}:`, error);
      throw error;
    }
  }
  
  if (FORCE_REPROCESS) {
    console.warn('[Run] FORCE_REPROCESS is enabled - all records will be regenerated.');
    // If START_FROM_RECORD is set, skip earlier records
    if (START_FROM_RECORD > 1) {
      console.warn(`[Run] Starting from record index ${START_FROM_RECORD} (skipping first ${START_FROM_RECORD - 1} records).`);
      return allRecords.slice(START_FROM_RECORD - 1);
    }
    return allRecords;
  }

  const { rows: doneRows } = await pool.query<{
    toy_num: string;
    tool_num: string;
    failure_mode: string;
  }>(
    `SELECT DISTINCT toy_num, tool_num, failure_mode
     FROM fmea_knowledge_base
     WHERE learning IS NOT NULL
       AND final_recommendation IS NOT NULL
       AND learning <> ''
       AND final_recommendation <> ''`
  );

  const doneKeys = new Set(
    doneRows.map(row => `${row.toy_num}||${row.tool_num}||${row.failure_mode}`)
  );

  return allRecords.filter(record => {
    const key = recordKey(record);
    return !doneKeys.has(`${key.toyNum}||${key.toolNum}||${key.failureMode}`);
  });
}

async function runPreflightCheck(pool: pg.Pool, pending: FMEARecord[]): Promise<void> {
  console.log('\n[Safety] Skipping pre-flight check (commented out for now)...');
  // Pre-flight check temporarily disabled
  // The record matching will still be validated during actual processing
  return;
  
  /* Original pre-flight code:
  console.log('\n[Safety] Running pre-flight image-record matching verification...');

  const sampleSize = Math.min(10, pending.length);
  const shuffled = [...Array(pending.length).keys()].sort(() => Math.random() - 0.5);

  let mismatchCount = 0;

  for (const idx of shuffled.slice(0, sampleSize)) {
    const record = pending[idx];
    const { toyNum, toolNum, failureMode } = recordKey(record);

    try {
      const { rows } = await pool.query<{
        toy_num: string;
        tool_num: string;
        failure_mode: string;
      }>(
        `SELECT toy_num, tool_num, failure_mode
         FROM fmea_knowledge_base
         WHERE toy_num = $1 AND tool_num = $2 AND failure_mode = $3
         LIMIT 1`,
        [toyNum, toolNum, failureMode]
      );

      if (
        rows.length === 0 ||
        rows[0].toy_num !== toyNum ||
        rows[0].tool_num !== toolNum ||
        rows[0].failure_mode !== failureMode
      ) {
        mismatchCount++;
      }
    } catch {
      mismatchCount++;
    }
  }

  if (mismatchCount > 0) {
    throw new Error(`[Safety] PRE-FLIGHT CHECK FAILED: ${mismatchCount} sampled records mismatched. Aborting.`);
  }
  */
}

async function run(): Promise<void> {
  const openai = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });

  const pool = new Pool({
    host: requireEnv('PG_HOST'),
    port: Number.parseInt(process.env.PG_PORT ?? '5432', 10),
    user: requireEnv('PG_USER'),
    password: requireEnv('PG_PASSWORD'),
    database: requireEnv('PG_DATABASE'),
    ssl: { rejectUnauthorized: false },
    max: CONCURRENCY + 2,
  });

  try {
    console.log('[Run] Loading raw_fmea_data.json...');
    const allRecords = await loadRecords();

    let pending = await getPendingRecords(pool, allRecords);

    if (TEST_MODE && pending.length > TEST_SIZE) {
      console.warn(`\n[TEST MODE] Limiting to first ${TEST_SIZE} records for quality verification.`);
      pending = pending.slice(0, TEST_SIZE);
    }

    if (pending.length === 0) {
      console.log('[Run] All records already synthesised. Nothing to do.');
      return;
    }

    await runPreflightCheck(pool, pending);

    console.log(`[Run] Pending records: ${pending.length}`);
    console.log(`[Run] Model: ${MODEL} | Image detail: ${IMAGE_DETAIL} | Max images: ${MAX_IMAGES}`);

    const stats: ProcessStats = {
      updated: 0,
      noImages: 0,
      notFound: 0,
      parseErrors: 0,
      apiErrors: 0,
      skippedByValidation: 0,
    };

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const chunk = pending.slice(i, i + CONCURRENCY);

      await Promise.all(
        chunk.map(record =>
          processRecord(record, openai, pool, stats).catch(err => {
            console.error(`[Fatal] Unhandled error for failure-${record.failureId}:`, err);
            stats.apiErrors++;
          })
        )
      );
    }

    console.log('\n[Run] ==================================================');
    console.log(`[Run] Updated this run : ${stats.updated}`);
    console.log(`[Run] Text-only rows   : ${stats.noImages}`);
    console.log(`[Run] Not found        : ${stats.notFound}`);
    console.log(`[Run] Parse errors     : ${stats.parseErrors}`);
    console.log(`[Run] API/DB errors    : ${stats.apiErrors}`);
    console.log(`[Run] Skipped by QA    : ${stats.skippedByValidation}`);
    console.log('[Run] ==================================================\n');
  } catch (error) {
    console.error('[Run] Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

export { run, buildUserPrompt, parseSynthesis, validateSynthesis };
