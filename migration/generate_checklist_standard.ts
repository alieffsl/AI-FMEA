/**
 * Combined FMEA + Product Standards checklist generation.
 *
 * Pipeline:
 * 1. Preserve every existing fmea_checklist entry as the historical baseline.
 * 2. Extract source-grounded controls from Product Standards and Baseline
 *    Standards with strict structured output.
 * 3. Merge only affected (tool x failure mode) groups, keeping the current
 *    checklist wording when standards add no distinct physical control.
 * 4. Validate provenance, index coverage, numerical claims, duplication, and
 *    imperative recommendation style.
 * 5. Replace fmea_checklist_standard atomically; fmea_checklist is untouched.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(__dirname, '.env') });

const MODEL = process.env.CHECKLIST_STANDARD_MODEL || 'gpt-5.6-terra';
const REASONING_EFFORT = process.env.CHECKLIST_STANDARD_REASONING_EFFORT || 'low';
const EMBEDDING_MODEL = process.env.CHECKLIST_STANDARD_EMBEDDING_MODEL || 'text-embedding-3-small';
const PROMPT_VERSION = 'checklist-standard-v3';
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const EXTRACT_ONLY = process.argv.includes('--extract-only');
const SOURCE_FILTER = getArgValue('--source');
const LIMIT = Number(getArgValue('--limit') || 0);
const MAX_ATTEMPTS = Math.max(2, Number(process.env.CHECKLIST_STANDARD_RETRY_ATTEMPTS || 4));
const CONCURRENCY = Math.max(1, Number(process.env.CHECKLIST_STANDARD_CONCURRENCY || 3));
const WORK_DIR = path.join(
  __dirname,
  'checklist_standard_work',
  MODEL.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
);
const EXTRACTION_DIR = path.join(WORK_DIR, 'extractions');
const MERGE_DIR = path.join(WORK_DIR, 'merges');
const REPORT_PATH = path.join(WORK_DIR, 'latest-report.json');

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is missing from migration/.env');
}

fs.mkdirSync(EXTRACTION_DIR, { recursive: true });
fs.mkdirSync(MERGE_DIR, { recursive: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15000,
});

type SourceType = 'historical_fmea' | 'product_standard' | 'baseline_standard';
type ApplicabilityScope = 'exact_tool' | 'global_process';

type HistoricalRow = {
  id: string;
  tool_description_normalized: string;
  tool_category: string | null;
  failure_mode: string;
  sub_concern_index: number;
  concern: string;
  recommendation: string;
  supporting_record_count: number;
  supporting_record_ids: string[];
  supporting_failure_ids: number[];
  default_severity: number | null;
  default_occurrence: number | null;
  default_detection: number | null;
  embedding: number[] | null;
  is_verified: boolean | null;
  verified_by: string | null;
};

type EvidenceItem = {
  index: number;
  heading: string;
  text: string;
  reference: string;
};

type StandardSource = {
  id: string;
  source_type: Exclude<SourceType, 'historical_fmea'>;
  slug: string;
  title: string;
  source_file: string;
  default_tool_hint: string;
  evidence: EvidenceItem[];
};

type ExtractedControl = {
  applicability_scope: ApplicabilityScope;
  tool_names: string[];
  tool_category: string;
  failure_mode: string;
  concern: string;
  recommendation: string;
  supporting_indices: number[];
  confidence: 'high' | 'medium';
};

type StandardReference = {
  source_type: Exclude<SourceType, 'historical_fmea'>;
  source_id: string;
  slug: string;
  title: string;
  source_file: string;
  section: string;
  reference: string;
  source_excerpt: string;
};

type StandardControl = ExtractedControl & {
  source: StandardSource;
  refs: StandardReference[];
};

type MergeEntry = {
  concern: string;
  recommendation: string;
  historical_indices: number[];
  standard_indices: number[];
};

type FinalRow = {
  tool_description_normalized: string;
  tool_category: string | null;
  failure_mode: string;
  sub_concern_index: number;
  concern: string;
  recommendation: string;
  applicability_scope: ApplicabilityScope;
  source_types: SourceType[];
  historical_checklist_ids: string[];
  supporting_record_count: number;
  supporting_record_ids: string[];
  supporting_failure_ids: number[];
  supporting_standard_refs: StandardReference[];
  default_severity: number | null;
  default_occurrence: number | null;
  default_detection: number | null;
  embedding: number[] | null;
  ai_model: string | null;
  prompt_version: string;
  content_hash: string;
  is_verified: boolean;
  verified_by: string | null;
};

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    controls: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          applicability_scope: { type: 'string', enum: ['exact_tool', 'global_process'] },
          tool_names: { type: 'array', items: { type: 'string' } },
          tool_category: { type: 'string' },
          failure_mode: { type: 'string' },
          concern: { type: 'string' },
          recommendation: { type: 'string' },
          supporting_indices: { type: 'array', items: { type: 'integer' }, minItems: 1 },
          confidence: { type: 'string', enum: ['high', 'medium'] },
        },
        required: [
          'applicability_scope',
          'tool_names',
          'tool_category',
          'failure_mode',
          'concern',
          'recommendation',
          'supporting_indices',
          'confidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['controls'],
  additionalProperties: false,
};

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          concern: { type: 'string' },
          recommendation: { type: 'string' },
          historical_indices: { type: 'array', items: { type: 'integer' } },
          standard_indices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['concern', 'recommendation', 'historical_indices', 'standard_indices'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
};

const EXCLUDED_STANDARD_FAILURE_MODES = new Set([
  'Cost Saving',
  'First Shot Failure',
  'Next Shot Failure',
  'Other',
]);

const FAILURE_EVIDENCE_TERMS: Record<string, string[]> = {
  'Abrasion Fail / Adhesion Fail': ['abrasion', 'adhesion'],
  'Bending': ['bend', 'bending'],
  'Broken part (Function)': ['break', 'broken', 'fracture'],
  'Color mismatch': ['color mismatch', 'colour mismatch'],
  'Deformed': ['deform', 'warping', 'warpage'],
  'Expose structure / Thin lining': ['expose', 'thin lining'],
  'Fail abuse': ['abuse', 'drop test', 'torque test', 'tension test'],
  'Fail life test': ['life test', 'cycle test', 'durability'],
  'Flash / Parting Line': ['flash', 'parting line'],
  'Gap Part': ['gap', 'clearance'],
  'Gate remnant (Sharp point)': ['gate remnant', 'gate vestige', 'sharp gate'],
  'Legal Marking': ['legal marking', 'legal mark'],
  'Loose part': ['loose', 'retention failure', 'detach'],
  'Marking': ['marking', 'mark'],
  'Misposition paint': ['misposition', 'paint position', 'print position'],
  'Missing Detail Sculpt': ['missing detail', 'detail reproduction'],
  'Over trimming': ['over trimming', 'over-trim'],
  'Over/excess glue': ['excess glue', 'over glue'],
  'Projection': ['projection', 'step-on'],
  'Rough surface': ['rough surface', 'surface roughness'],
  'Scratch': ['scratch'],
  'Scratch (Molding)': ['scratch', 'sticking', 'ejection mark'],
  'Sharp point': ['sharp point', 'sharp edge', 'radius'],
  'Shiny (Surface finish)': ['shiny', 'surface finish', 'gloss'],
  'Short shot': ['short shot', 'incomplete fill', 'incomplete filling'],
  'Sink mark': ['sink mark', 'sink'],
  'Sticking': ['sticking', 'stick', 'ejection'],
  'Tear Part': ['tear', 'tearing'],
  'Under Spray': ['under spray', 'underspray'],
  'Weldline': ['weld line', 'weldline'],
  'White Mark': ['white mark', 'stress whitening'],
};

const EXTRACTION_INSTRUCTIONS = `Role: Mechanical tooling FMEA standards editor.

Goal: Convert one Product Standard or Baseline Standard into the smallest useful set of source-grounded checklist controls that can complement an existing historical FMEA checklist.

Success criteria:
- return only explicit, actionable engineering controls supported by the supplied evidence;
- map each control to one allowed failure mode and, for exact applicability, only allowed tool names;
- preserve exact dimensions, materials, formulas, and limits from evidence;
- combine repeated wording that describes the same physical mechanism;
- use the same natural engineering style as the existing checklist.

Constraints:
- Do not invent a failure, mechanism, dimension, material, limit, or applicability.
- Skip overview, catalog, sourcing, model-list, and descriptive content without a reusable design or tooling control.
- Most sources should produce 0-3 controls; 6 is a hard maximum.
- Use global_process only when no allowed tool names are supplied and the evidence explicitly applies across injection-molded tools or a general process. Global controls enrich an already-known failure; they do not create a new failure for every tool.
- When allowed tool names are supplied, use exact_tool for every returned control and select only the names whose part/tool family matches the evidence. Return only names from ALLOWED TOOL NAMES.
- Use only a failure mode from ALLOWED FAILURE MODES.
- A specific failure mode is allowed only when the evidence explicitly names that defect or its direct synonym. For example, a hole dimension alone does not prove Short shot, and a wall-thickness value alone does not prove Sink mark.
- Evidence that explicitly says a control prevents or avoids a defect directly supports that defect.
- For an explicit dimension, material, geometry, or fit requirement with no stated defect, use Improper function or Improper Assembly and describe the nonconforming condition without inventing a downstream mechanism. Omit it if even that relationship is unclear.
- A concern is one concise physical risk statement. Avoid project storytelling and phrases such as "the standard says."
- A recommendation is one concise imperative sentence beginning with a direct engineering action verb such as Add, Adjust, Align, Apply, Avoid, Check, Control, Design, Increase, Limit, Locate, Maintain, Modify, Orient, Place, Provide, Reduce, Relocate, Remove, Review, Select, Set, Size, Specify, Test, Use, Validate, or Verify.
- Do not begin a recommendation with "Ensure."
- supporting_indices must cite every evidence item used for the control.
- Omit a control when its source support or applicability is uncertain.

Stop after the smallest complete, non-redundant set is represented in the required JSON schema.`;

const MERGE_INSTRUCTIONS = `Role: Mechanical tooling FMEA checklist editor.

Goal: Preserve the cohesion, coherence, format, and natural engineering voice of an existing historical checklist while integrating only distinct, source-grounded Product/Baseline Standard controls.

Success criteria:
- keep every historical concern represented exactly once;
- treat each historical entry as an immutable quality anchor rather than reconsolidating historical entries with each other;
- preserve an existing historical concern and recommendation verbatim when standards add no distinct requirement;
- merge a standard into an existing entry when both address the same physical mechanism;
- create a separate entry only when fixing one mechanism would not fix the other;
- use the smallest non-redundant set, normally 1-3 entries;
- preserve all exact source-backed dimensions and limits.

Constraints:
- Do not invent facts or numbers.
- Do not make wording longer merely to mention both sources.
- Do not repeat the same concern or action with synonyms.
- Each output entry may reference at most one historical index.
- If an output entry has a historical index and no standard index, copy that historical concern and recommendation verbatim.
- Modify historical wording only when one or more cited standards add a precise requirement to the same physical mechanism.
- Concerns are concise physical-risk statements.
- Recommendations are concise imperative actions and do not begin with "Ensure."
- historical_indices and standard_indices identify exactly which inputs support each result.
- Every historical index must appear in at least one output entry.
- A standard index may be omitted when it is redundant, non-actionable, or less reliable than the historical control.

Stop after the smallest complete set is represented in the required JSON schema.`;

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sanitizeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120);
}

function compact(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return results;
}

function getNumbers(value: string): string[] {
  return unique((value.match(/\d+(?:\.\d+)?/g) || []).map((item) => String(Number(item))));
}

function jaccard(left: string, right: string): number {
  const a = new Set(compact(left).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const b = new Set(compact(right).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function validateNoDuplicates(entries: Array<{ concern: string; recommendation: string }>): string[] {
  const errors: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const concernScore = jaccard(entries[i].concern, entries[j].concern);
      const actionScore = jaccard(entries[i].recommendation, entries[j].recommendation);
      if (concernScore >= 0.72 || actionScore >= 0.78) {
        errors.push(`Entries ${i} and ${j} are semantically repetitive.`);
      }
    }
  }
  return errors;
}

function validateRecommendation(value: string): string | null {
  if (/^ensure\b/i.test(value)) return 'Recommendation must not begin with Ensure.';
  if (!/^[A-Za-z][A-Za-z-]*\b/.test(value) || /^(The|This|It|There)\b/i.test(value)) {
    return 'Recommendation must begin directly with an engineering action.';
  }
  return null;
}

async function structuredResponse<T>(
  name: string,
  schema: object,
  instructions: string,
  input: string,
  validate: (value: T) => string[],
): Promise<T> {
  let feedback = '';
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.responses.create({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT as any },
        instructions,
        input: feedback ? `${input}\n\nVALIDATION FEEDBACK FROM PRIOR ATTEMPT:\n${feedback}` : input,
        max_output_tokens: 5000,
        text: {
          verbosity: 'low',
          format: { type: 'json_schema', name, strict: true, schema },
        } as any,
      });
      if (response.status !== 'completed' || !response.output_text) {
        throw new Error(`Incomplete response: ${response.incomplete_details?.reason || response.status}`);
      }
      const parsed = JSON.parse(response.output_text) as T;
      const errors = validate(parsed);
      if (!errors.length) return parsed;
      feedback = errors.join('\n');
      lastError = new Error(feedback);
    } catch (error) {
      lastError = error;
      feedback = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function formatTable(table: any): string {
  if (!table?.columns || !Array.isArray(table.rows)) return '';
  return [
    `Columns: ${table.columns.join(' | ')}`,
    ...table.rows.map((row: unknown[]) => row.join(' | ')),
  ].join('\n');
}

function loadStandardSources(): StandardSource[] {
  const pages = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/data/mec_product_standard_v2.json'), 'utf8'),
  );
  const sourceMapping = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/data/sourceMapping.json'), 'utf8'),
  );
  const accessory = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/data/accessory_tooling_ai_database.json'), 'utf8'),
  );

  const productSources: StandardSource[] = pages.map((page: any) => ({
    id: `product:${page.slug}`,
    source_type: 'product_standard',
    slug: page.slug,
    title: page.title,
    source_file: sourceMapping[page.slug] || '',
    default_tool_hint: page.title,
    evidence: (page.sections || [])
      .map((section: any, index: number) => ({
        index,
        heading: compact(section.title),
        text: compact([section.content, formatTable(section.table)].filter(Boolean).join('\n')),
        reference: `section:${index + 1}`,
      }))
      .filter((item: EvidenceItem) => item.text),
  }));

  const baselineSources: StandardSource[] = accessory.standards.map((standard: any) => ({
    id: `baseline:${standard.slug}`,
    source_type: 'baseline_standard',
    slug: standard.slug,
    title: standard.title,
    source_file: `${standard.source_workbook || accessory.source_workbook}#${standard.source_sheet}`,
    default_tool_hint: standard.title,
    evidence: (standard.checkpoints || [])
      .filter((checkpoint: any) => checkpoint.confidence !== 'low' && !checkpoint.review_required)
      .map((checkpoint: any, index: number) => ({
        index,
        heading: compact(checkpoint.title),
        text: compact([
          checkpoint.requirement,
          checkpoint.acceptance_criteria,
          checkpoint.applicability,
          checkpoint.verification_method,
        ].filter(Boolean).join(' | ')),
        reference: checkpoint.id || `checkpoint:${index + 1}`,
      }))
      .filter((item: EvidenceItem) => item.text),
  }));

  return [...productSources, ...baselineSources].filter((source) => source.evidence.length > 0);
}

const STOP_TOKENS = new Set([
  'design', 'guideline', 'guidelines', 'standard', 'standards', 'barbie', 'doll',
  'tool', 'tools', 'mold', 'molding', 'product', 'general', 'development', 'for',
  'with', 'and', 'the', 'insert', 'assembly', 'process',
]);

const TOKEN_EXPANSIONS: Record<string, string[]> = {
  arm: ['arm', 'elbow', 'shoulder'],
  belt: ['belt'],
  bracelet: ['bracelet', 'bangle'],
  crown: ['crown', 'tiara'],
  earring: ['earring', 'earrings', 'ear'],
  gear: ['gear'],
  glasses: ['glasses', 'sunglass', 'sunglasses', 'eyewear'],
  hand: ['hand', 'finger'],
  headband: ['headband', 'head band'],
  horse: ['horse', 'pony'],
  leg: ['leg', 'knee'],
  necklace: ['necklace'],
  shoe: ['shoe', 'shoes', 'boot', 'boots', 'booties', 'footwear'],
  torso: ['torso', 'body'],
};

function tokens(value: string): string[] {
  return unique(
    value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOP_TOKENS.has(token)),
  );
}

function candidateTools(source: StandardSource, allTools: string[]): string[] {
  const sourceTokens = tokens(`${source.default_tool_hint} ${source.slug}`);
  const expanded = new Set(sourceTokens);
  for (const token of sourceTokens) {
    for (const alias of TOKEN_EXPANSIONS[token] || []) expanded.add(alias);
  }
  const scores = allTools.map((tool) => {
    const lower = tool.toLowerCase();
    let score = 0;
    for (const token of expanded) {
      if (lower === token) score += 8;
      else if (lower.includes(token) || token.includes(lower)) score += 3;
    }
    return { tool, score };
  });
  return scores
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool))
    .slice(0, 40)
    .map((item) => item.tool);
}

function extractionCachePath(source: StandardSource, candidates: string[], failures: string[]): string {
  const hash = stableHash({ source, candidates, failures, prompt: PROMPT_VERSION });
  return path.join(EXTRACTION_DIR, `${sanitizeFilename(source.id)}-${hash.slice(0, 12)}.json`);
}

function buildSourceRefs(source: StandardSource, indices: number[]): StandardReference[] {
  return unique(indices)
    .map((index) => source.evidence[index])
    .filter(Boolean)
    .map((item) => ({
      source_type: source.source_type,
      source_id: source.id,
      slug: source.slug,
      title: source.title,
      source_file: source.source_file,
      section: item.heading,
      reference: item.reference,
      source_excerpt: item.text.slice(0, 800),
    }));
}

async function extractControls(
  source: StandardSource,
  candidates: string[],
  failureModes: string[],
): Promise<StandardControl[]> {
  const cachePath = extractionCachePath(source, candidates, failureModes);
  if (!FORCE && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ExtractedControl[];
    return cached.map((control) => ({
      ...control,
      source,
      refs: buildSourceRefs(source, control.supporting_indices),
    }));
  }

  const evidenceText = source.evidence
    .map((item) => `[${item.index}] ${item.heading}\n${item.text}`)
    .join('\n\n');
  const input = `SOURCE TYPE: ${source.source_type}
SOURCE ID: ${source.id}
TITLE: ${source.title}
SOURCE FILE: ${source.source_file || 'not mapped'}

ALLOWED TOOL NAMES:
${candidates.length ? candidates.map((tool) => `- ${tool}`).join('\n') : '- none; only global_process may be returned'}

ALLOWED FAILURE MODES:
${failureModes.map((mode) => `- ${mode}`).join('\n')}

SOURCE EVIDENCE:
${evidenceText}`;

  const result = await structuredResponse<{ controls: ExtractedControl[] }>(
    'standard_checklist_controls',
    EXTRACTION_SCHEMA,
    EXTRACTION_INSTRUCTIONS,
    input,
    (value) => {
      const errors: string[] = [];
      if (!Array.isArray(value.controls)) return ['controls must be an array.'];
      for (const [index, control] of value.controls.entries()) {
        if (!failureModes.includes(control.failure_mode)) {
          errors.push(`Control ${index} uses a failure mode outside the allowed list.`);
        }
        if (control.applicability_scope === 'exact_tool') {
          if (!control.tool_names.length) errors.push(`Control ${index} needs an exact tool name.`);
          for (const tool of control.tool_names) {
            if (!candidates.includes(tool)) errors.push(`Control ${index} uses unapproved tool "${tool}".`);
          }
        } else if (control.tool_names.length) {
          errors.push(`Global control ${index} must use an empty tool_names array.`);
        } else if (candidates.length) {
          errors.push(
            `Control ${index} must use exact_tool because allowed tool names were supplied. ` +
            `Select only names that match the source's part/tool family.`,
          );
        }
        const invalidIndex = control.supporting_indices.find((i) => !Number.isInteger(i) || !source.evidence[i]);
        if (invalidIndex !== undefined) errors.push(`Control ${index} has an invalid evidence index.`);
        const actionError = validateRecommendation(control.recommendation);
        if (actionError) errors.push(`Control ${index}: ${actionError}`);
        const corpus = control.supporting_indices
          .map((i) => source.evidence[i]?.text || '')
          .join(' ');
        const requiredTerms = FAILURE_EVIDENCE_TERMS[control.failure_mode];
        if (
          requiredTerms &&
          !requiredTerms.some((term) => corpus.toLowerCase().includes(term))
        ) {
          errors.push(
            `Control ${index} maps to "${control.failure_mode}" without an explicit source term. ` +
            `Use Improper function/Improper Assembly without an invented effect, or omit it.`,
          );
        }
        const unsupportedNumbers = getNumbers(`${control.concern} ${control.recommendation}`)
          .filter((number) => !getNumbers(corpus).includes(number));
        if (unsupportedNumbers.length) {
          errors.push(`Control ${index} introduced unsupported numbers: ${unsupportedNumbers.join(', ')}.`);
        }
      }
      errors.push(...validateNoDuplicates(value.controls));
      return errors;
    },
  );

  fs.writeFileSync(cachePath, JSON.stringify(result.controls, null, 2));
  return result.controls.map((control) => ({
    ...control,
    source,
    refs: buildSourceRefs(source, control.supporting_indices),
  }));
}

function mergeCachePath(
  tool: string,
  failureMode: string,
  historical: HistoricalRow[],
  standards: StandardControl[],
): string {
  const hash = stableHash({ tool, failureMode, historical, standards, prompt: PROMPT_VERSION });
  return path.join(MERGE_DIR, `${sanitizeFilename(`${tool}-${failureMode}`)}-${hash.slice(0, 12)}.json`);
}

async function mergeGroup(
  tool: string,
  failureMode: string,
  historical: HistoricalRow[],
  standards: StandardControl[],
): Promise<MergeEntry[]> {
  const cachePath = mergeCachePath(tool, failureMode, historical, standards);
  if (!FORCE && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as MergeEntry[];
  }

  const maxEntries = Math.min(12, Math.max(1, historical.length + Math.min(3, standards.length)));
  const input = `TOOL: ${tool}
FAILURE MODE: ${failureMode}
MAXIMUM OUTPUT ENTRIES: ${maxEntries}

HISTORICAL CHECKLIST INPUTS:
${historical.length ? historical.map((row, index) => (
  `[H${index}] Concern: ${row.concern}\nRecommendation: ${row.recommendation}`
)).join('\n\n') : '(none)'}

STANDARD INPUTS:
${standards.map((control, index) => (
  `[S${index}] ${control.source.source_type} / ${control.source.title}\n` +
  `Concern: ${control.concern}\nRecommendation: ${control.recommendation}\n` +
  `Evidence: ${control.refs.map((ref) => `${ref.section}: ${ref.source_excerpt}`).join(' | ')}`
)).join('\n\n')}`;

  let result: { entries: MergeEntry[] };
  try {
    result = await structuredResponse<{ entries: MergeEntry[] }>(
      'merged_checklist_entries',
      MERGE_SCHEMA,
      MERGE_INSTRUCTIONS,
      input,
      (value) => {
      const errors: string[] = [];
      if (!Array.isArray(value.entries) || !value.entries.length) return ['entries must be a non-empty array.'];
      if (value.entries.length > maxEntries) errors.push(`Output exceeds maximum ${maxEntries} entries.`);
      const historicalCoverage = new Map<number, number>();
      for (const [index, entry] of value.entries.entries()) {
        if (entry.historical_indices.length > 1) {
          errors.push(`Entry ${index} combines multiple historical anchors.`);
        }
        for (const h of entry.historical_indices) {
          if (!Number.isInteger(h) || !historical[h]) errors.push(`Entry ${index} has invalid H${h}.`);
          else historicalCoverage.set(h, (historicalCoverage.get(h) || 0) + 1);
        }
        for (const s of entry.standard_indices) {
          if (!Number.isInteger(s) || !standards[s]) errors.push(`Entry ${index} has invalid S${s}.`);
        }
        if (!entry.historical_indices.length && !entry.standard_indices.length) {
          errors.push(`Entry ${index} has no supporting input.`);
        }
        if (entry.historical_indices.length === 1 && entry.standard_indices.length === 0) {
          const anchor = historical[entry.historical_indices[0]];
          // Historical-only entries are immutable anchors. Normalize them in code
          // instead of spending another model call asking for an exact copy.
          entry.concern = anchor.concern;
          entry.recommendation = anchor.recommendation;
        }
        const actionError = validateRecommendation(entry.recommendation);
        if (actionError) errors.push(`Entry ${index}: ${actionError}`);
        const corpus = [
          ...entry.historical_indices.map((i) => `${historical[i]?.concern || ''} ${historical[i]?.recommendation || ''}`),
          ...entry.standard_indices.map((i) => standards[i]?.refs.map((ref) => ref.source_excerpt).join(' ') || ''),
        ].join(' ');
        const corpusNumbers = getNumbers(corpus);
        const unsupportedNumbers = getNumbers(`${entry.concern} ${entry.recommendation}`)
          .filter((number) => !corpusNumbers.includes(number));
        if (unsupportedNumbers.length) {
          errors.push(`Entry ${index} introduced unsupported numbers: ${unsupportedNumbers.join(', ')}.`);
        }
      }
      for (let i = 0; i < historical.length; i += 1) {
        const count = historicalCoverage.get(i) || 0;
        if (count !== 1) errors.push(`Historical input H${i} must appear exactly once; found ${count}.`);
      }
      errors.push(...validateNoDuplicates(value.entries));
        return errors;
      },
    );
  } catch (error) {
    console.warn(
      `[Merge fallback] ${tool} / ${failureMode}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const entries: MergeEntry[] = historical.map((row, index) => ({
      concern: row.concern,
      recommendation: row.recommendation,
      historical_indices: [index],
      standard_indices: [],
    }));
    const availableStandardSlots = Math.max(0, maxEntries - entries.length);
    for (const [index, control] of standards.slice(0, availableStandardSlots).entries()) {
      const isDuplicate = entries.some((entry) => (
        tokens(entry.concern).join(' ') === tokens(control.concern).join(' ') &&
        tokens(entry.recommendation).join(' ') === tokens(control.recommendation).join(' ')
      ));
      if (!isDuplicate) {
        entries.push({
          concern: control.concern,
          recommendation: control.recommendation,
          historical_indices: [],
          standard_indices: [index],
        });
      }
    }
    result = { entries };
  }
  fs.writeFileSync(cachePath, JSON.stringify(result.entries, null, 2));
  return result.entries;
}

function historicalToFinal(row: HistoricalRow): FinalRow {
  return {
    tool_description_normalized: row.tool_description_normalized,
    tool_category: row.tool_category,
    failure_mode: row.failure_mode,
    sub_concern_index: row.sub_concern_index,
    concern: row.concern,
    recommendation: row.recommendation,
    applicability_scope: 'exact_tool',
    source_types: ['historical_fmea'],
    historical_checklist_ids: [row.id],
    supporting_record_count: row.supporting_record_count,
    supporting_record_ids: row.supporting_record_ids || [],
    supporting_failure_ids: row.supporting_failure_ids || [],
    supporting_standard_refs: [],
    default_severity: row.default_severity,
    default_occurrence: row.default_occurrence,
    default_detection: row.default_detection,
    embedding: row.embedding,
    ai_model: null,
    prompt_version: PROMPT_VERSION,
    content_hash: stableHash([row.concern, row.recommendation]),
    is_verified: Boolean(row.is_verified),
    verified_by: row.verified_by,
  };
}

function mergedToFinal(
  tool: string,
  failureMode: string,
  entries: MergeEntry[],
  historical: HistoricalRow[],
  standards: StandardControl[],
): FinalRow[] {
  return entries.map((entry, index) => {
    const historicalRows = entry.historical_indices.map((i) => historical[i]).filter(Boolean);
    const standardRows = entry.standard_indices.map((i) => standards[i]).filter(Boolean);
    const sourceTypes = unique<SourceType>([
      ...(historicalRows.length ? ['historical_fmea' as const] : []),
      ...standardRows.map((row) => row.source.source_type),
    ]);
    const refs = standardRows.flatMap((row) => row.refs);
    const firstHistorical = historicalRows[0];
    return {
      tool_description_normalized: tool,
      tool_category: firstHistorical?.tool_category || standardRows[0]?.tool_category || null,
      failure_mode: failureMode,
      sub_concern_index: index + 1,
      concern: entry.concern,
      recommendation: entry.recommendation,
      applicability_scope: tool === '*' ? 'global_process' : 'exact_tool',
      source_types: sourceTypes,
      historical_checklist_ids: unique(historicalRows.map((row) => row.id)),
      supporting_record_count: historicalRows.reduce((sum, row) => sum + row.supporting_record_count, 0),
      supporting_record_ids: unique(historicalRows.flatMap((row) => row.supporting_record_ids || [])),
      supporting_failure_ids: unique(historicalRows.flatMap((row) => row.supporting_failure_ids || [])),
      supporting_standard_refs: refs,
      default_severity: firstHistorical?.default_severity || null,
      default_occurrence: firstHistorical?.default_occurrence || null,
      default_detection: firstHistorical?.default_detection || null,
      embedding: null,
      ai_model: MODEL,
      prompt_version: PROMPT_VERSION,
      content_hash: stableHash([tool, failureMode, entry.concern, entry.recommendation, refs]),
      is_verified: false,
      verified_by: null,
    };
  });
}

async function generateEmbeddings(rows: FinalRow[]): Promise<void> {
  const targets = rows.filter((row) => !row.embedding);
  const batchSize = 100;
  for (let offset = 0; offset < targets.length; offset += batchSize) {
    const batch = targets.slice(offset, offset + batchSize);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((row) => (
        `${row.tool_description_normalized} ${row.failure_mode}: ${row.concern} ${row.recommendation}`
      )),
    });
    response.data.forEach((item, index) => {
      batch[index].embedding = item.embedding;
    });
    console.log(`[Embedding] ${Math.min(offset + batch.length, targets.length)}/${targets.length}`);
  }
}

function validateFinalRows(rows: FinalRow[], historical: HistoricalRow[]): void {
  const errors: string[] = [];
  const keys = new Set<string>();
  const historicalCoverage = new Set(rows.flatMap((row) => row.historical_checklist_ids));
  for (const row of rows) {
    const key = `${row.tool_description_normalized}||${row.failure_mode}||${row.sub_concern_index}`;
    if (keys.has(key)) errors.push(`Duplicate unique key: ${key}`);
    keys.add(key);
    if (!row.concern || !row.recommendation) errors.push(`Empty content: ${key}`);
    if (!row.source_types.length) errors.push(`Missing source type: ${key}`);
    if (row.source_types.includes('product_standard') || row.source_types.includes('baseline_standard')) {
      if (!row.supporting_standard_refs.length) errors.push(`Missing standard provenance: ${key}`);
    }
  }
  for (const row of historical) {
    if (!historicalCoverage.has(row.id)) errors.push(`Historical checklist row was lost: ${row.id}`);
  }
  if (errors.length) {
    throw new Error(`Final validation failed:\n${errors.slice(0, 50).join('\n')}`);
  }
}

async function writeTable(rows: FinalRow[], generationRunId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'create_checklist_standard_table.sql'), 'utf8');
    await client.query(schema);
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE fmea_checklist_standard');
    for (const row of rows) {
      await client.query(
        `INSERT INTO fmea_checklist_standard (
          tool_description_normalized, tool_category, failure_mode, sub_concern_index,
          concern, recommendation, applicability_scope, source_types,
          historical_checklist_ids, supporting_record_count, supporting_record_ids,
          supporting_failure_ids, supporting_standard_refs, default_severity,
          default_occurrence, default_detection, embedding, ai_model, prompt_version,
          generation_run_id, content_hash, is_verified, verified_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
        )`,
        [
          row.tool_description_normalized,
          row.tool_category,
          row.failure_mode,
          row.sub_concern_index,
          row.concern,
          row.recommendation,
          row.applicability_scope,
          row.source_types,
          row.historical_checklist_ids,
          row.supporting_record_count,
          row.supporting_record_ids,
          row.supporting_failure_ids,
          JSON.stringify(row.supporting_standard_refs),
          row.default_severity,
          row.default_occurrence,
          row.default_detection,
          JSON.stringify(row.embedding),
          row.ai_model,
          row.prompt_version,
          generationRunId,
          row.content_hash,
          row.is_verified,
          row.verified_by,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const generationRunId = crypto.randomUUID();
  const historicalResult = await pool.query<HistoricalRow>(`
    SELECT id, tool_description_normalized, tool_category, failure_mode,
      sub_concern_index, concern, recommendation, supporting_record_count,
      supporting_record_ids, supporting_failure_ids, default_severity,
      default_occurrence, default_detection, embedding, is_verified, verified_by
    FROM fmea_checklist
    ORDER BY tool_description_normalized, failure_mode, sub_concern_index
  `);
  const historical = historicalResult.rows;
  const allTools = unique(historical.map((row) => row.tool_description_normalized)).sort();
  const failureModes = unique(historical.map((row) => row.failure_mode))
    .filter((mode) => !EXCLUDED_STANDARD_FAILURE_MODES.has(mode))
    .sort();
  let sources = loadStandardSources();
  if (SOURCE_FILTER) sources = sources.filter((source) => source.slug === SOURCE_FILTER || source.id === SOURCE_FILTER);
  if (LIMIT > 0) sources = sources.slice(0, LIMIT);

  console.log(`[Pipeline] Model: ${MODEL} (${REASONING_EFFORT})`);
  console.log(`[Pipeline] Historical entries: ${historical.length}`);
  console.log(`[Pipeline] Standard sources: ${sources.length}`);
  console.log(`[Pipeline] Concurrency: ${CONCURRENCY}`);
  console.log(`[Pipeline] Dry run: ${DRY_RUN}`);

  const controlsBySource = await mapConcurrent(sources, CONCURRENCY, async (source, index) => {
    const candidates = candidateTools(source, allTools);
    console.log(`[Extract ${index + 1}/${sources.length}] ${source.id} (${candidates.length} candidate tools)`);
    const controls = await extractControls(source, candidates, failureModes);
    console.log(`  -> ${controls.length} controls`);
    return controls;
  });
  const extracted = controlsBySource.flat();

  if (EXTRACT_ONLY) {
    const report = {
      generation_run_id: generationRunId,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      historical_entry_count: historical.length,
      source_count: sources.length,
      extracted_control_count: extracted.length,
      controls: extracted,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`[Pipeline] Extraction report: ${REPORT_PATH}`);
    await pool.end();
    return;
  }

  const standardsByGroup = new Map<string, StandardControl[]>();
  for (const control of extracted) {
    const tools = control.applicability_scope === 'global_process' ? ['*'] : control.tool_names;
    for (const tool of tools) {
      const key = `${tool}||${control.failure_mode}`;
      standardsByGroup.set(key, [...(standardsByGroup.get(key) || []), control]);
    }
  }
  const historicalByGroup = new Map<string, HistoricalRow[]>();
  for (const row of historical) {
    const key = `${row.tool_description_normalized}||${row.failure_mode}`;
    historicalByGroup.set(key, [...(historicalByGroup.get(key) || []), row]);
  }

  const affectedKeys = [...standardsByGroup.keys()].sort();
  const finalRows: FinalRow[] = [];
  for (const [key, rows] of historicalByGroup) {
    if (!standardsByGroup.has(key)) finalRows.push(...rows.map(historicalToFinal));
  }
  const mergedGroups = await mapConcurrent(affectedKeys, CONCURRENCY, async (key, index) => {
    const separator = key.indexOf('||');
    const tool = key.slice(0, separator);
    const failureMode = key.slice(separator + 2);
    const historicalRows = historicalByGroup.get(key) || [];
    const standardRows = standardsByGroup.get(key) || [];
    console.log(`[Merge ${index + 1}/${affectedKeys.length}] ${tool} / ${failureMode} (H${historicalRows.length}, S${standardRows.length})`);
    const merged = await mergeGroup(tool, failureMode, historicalRows, standardRows);
    return mergedToFinal(tool, failureMode, merged, historicalRows, standardRows);
  });
  finalRows.push(...mergedGroups.flat());

  finalRows.sort((a, b) => (
    a.tool_description_normalized.localeCompare(b.tool_description_normalized) ||
    a.failure_mode.localeCompare(b.failure_mode) ||
    a.sub_concern_index - b.sub_concern_index
  ));
  validateFinalRows(finalRows, historical);
  await generateEmbeddings(finalRows);

  const report = {
    generation_run_id: generationRunId,
    generated_at: new Date().toISOString(),
    model: MODEL,
    reasoning_effort: REASONING_EFFORT,
    concurrency: CONCURRENCY,
    embedding_model: EMBEDDING_MODEL,
    prompt_version: PROMPT_VERSION,
    historical_entry_count: historical.length,
    standard_source_count: sources.length,
    extracted_control_count: extracted.length,
    affected_group_count: affectedKeys.length,
    final_entry_count: finalRows.length,
    product_standard_entry_count: finalRows.filter((row) => row.source_types.includes('product_standard')).length,
    baseline_standard_entry_count: finalRows.filter((row) => row.source_types.includes('baseline_standard')).length,
    global_process_entry_count: finalRows.filter((row) => row.applicability_scope === 'global_process').length,
    dry_run: DRY_RUN,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('[Pipeline] Report:', report);

  if (!DRY_RUN) {
    await writeTable(finalRows, generationRunId);
    console.log(`[Pipeline] Wrote ${finalRows.length} rows to fmea_checklist_standard.`);
  } else {
    console.log('[Pipeline] Dry run complete; database was not changed.');
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error('[Pipeline] Fatal error:', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
