import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { matchChecklistEntries, matchChecklistBatch, getChecklistStats } from './checklistService';
import { normalizeToolDescription } from './normalizeToolDescription';

dotenv.config({
  path: process.env.FMEA_ENV_FILE || path.resolve(process.cwd(), '../migration/.env'),
});

const { Pool } = pg;

/** Hard ceiling on tool rows accepted in one generate request. */
const MAX_TOOLS_PER_REQUEST = 500;

/**
 * Parse a query-string integer, clamping into range and falling back on a
 * default. Unclamped values previously allowed `?limit=10000000` and produced a
 * negative OFFSET (a 500) for `?page=0`.
 */
function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Parse a float, falling back when the value is absent or not a number. */
function parseBoundedFloat(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

// PostgreSQL connection pool for better performance
let pgPool: pg.Pool | null = null;

function getPgPool(): pg.Pool {
  if (!pgPool) {
    pgPool = new Pool({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT || '5432'),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      ssl: { rejectUnauthorized: false },
      max: 20, // Maximum pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pgPool;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper function: Intelligent default severity based on failure mode keywords
function getDefaultSeverity(failureMode: string): number {
  const mode = (failureMode || '').toLowerCase();

  // Critical/Safety issues: 9-10
  if (mode.includes('safety') || mode.includes('injury') || mode.includes('sharp edge')) {
    return 9;
  }

  // High severity: 7-8
  if (mode.includes('break') || mode.includes('tear') || mode.includes('crack') ||
    mode.includes('fail') || mode.includes('fracture')) {
    return 8;
  }

  // Medium-high severity: 6-7
  if (mode.includes('gap') || mode.includes('flash') || mode.includes('warp') ||
    mode.includes('sink') || mode.includes('short shot') || mode.includes('burn')) {
    return 7;
  }

  // Medium severity: 5-6
  if (mode.includes('scratch') || mode.includes('mark') || mode.includes('stain') ||
    mode.includes('color') || mode.includes('gate')) {
    return 6;
  }

  // Low severity: 3-4
  if (mode.includes('appearance') || mode.includes('cosmetic') || mode.includes('texture')) {
    return 4;
  }

  // Default: medium severity
  return 6;
}

// `cleanToolDescription` was removed here. It was a fourth tool-description
// normalizer used only by the dashboard, and it truncated a description to its
// first word ("Torso FT" -> "Torso", "Hair Clip" -> "Hair"), which merged tools
// the rest of the system deliberately keeps distinct. The dashboard now groups
// on `tool_description_normalized`, the same key the matcher uses.

app.post('/api/fmea/generate', async (req, res) => {
  try {
    const tools = req.body.tools || [];
    const metadata = req.body.metadata || {};

    if (!Array.isArray(tools) || tools.length === 0) {
      return res.status(400).json({ error: 'No tools provided.' });
    }

    if (tools.length > MAX_TOOLS_PER_REQUEST) {
      return res.status(413).json({
        error: `Too many tools in one request (${tools.length}). The maximum is ${MAX_TOOLS_PER_REQUEST}.`,
      });
    }

    console.log(`[Server] Received ${tools.length} NEW tools (CDI format) for FMEA generation`);

    // Step 1: Query PostgreSQL to find historical failures for similar tools.
    // Uses the shared pool: this handler previously opened up to three separate
    // one-off connections per request while the pool sat unused.
    const client = getPgPool();

    // Normalize tool descriptions server-side for consistent matching
    const uniqueDescriptions = Array.from(
      new Set(tools.map((t: any) => normalizeToolDescription(t.toolDescription)).filter(Boolean))
    );
    console.log(`[Server] Looking up historical failures for: ${uniqueDescriptions.join(', ')}`);

    // Garbage filter clause reused across queries
    const FAILURE_FILTER = `
      AND failure_mode IS NOT NULL
      AND failure_mode != ''
      AND failure_mode NOT ILIKE '%cost%'
      AND failure_mode NOT ILIKE '%saving%'
      AND failure_mode NOT ILIKE 'no %'
      AND failure_mode NOT ILIKE 'none%'
      AND failure_mode !~ '^[0-9]'
      AND LENGTH(failure_mode) > 4
    `;

    // Position suffixes removed - "Leg" and "Leg LT" are DIFFERENT tools per user requirements

    // Find historical failure modes from PostgreSQL knowledge base
    const historicalFailures: Map<string, Set<string>> = new Map();

    // OPTIMIZED: Fetch ALL failure modes in a single batch query
    const allToolDescriptions = new Set<string>();

    for (const desc of uniqueDescriptions) {
      const toolDesc = String(desc);
      allToolDescriptions.add(toolDesc.toLowerCase());
    }

    // Single query to fetch all relevant failure modes (exact matches only)
    const allDescArray = [...allToolDescriptions];
    const placeholders = allDescArray.map((_, i) => `$${i + 1}`).join(',');

    const batchResult = await client.query(`
      SELECT DISTINCT 
        tool_description_normalized,
        failure_mode
      FROM fmea_knowledge_base
      WHERE LOWER(tool_description_normalized) IN (${placeholders})
        ${FAILURE_FILTER}
    `, allDescArray);

    // Add exact, standards-backed failure modes. Global process controls are
    // intentionally excluded here: they may enrich a known failure later, but
    // must not create the same failure mode for every uploaded tool.
    const standardFailureResult = await client.query(`
      SELECT DISTINCT
        tool_description_normalized,
        failure_mode
      FROM fmea_checklist_standard
      WHERE LOWER(tool_description_normalized) IN (${placeholders})
        AND applicability_scope = 'exact_tool'
        AND source_types && ARRAY['product_standard', 'baseline_standard']::text[]
        ${FAILURE_FILTER}
    `, allDescArray);

    // Group historical and standards-backed results by exact tool description.
    const failuresByTool = new Map<string, Set<string>>();
    for (const row of batchResult.rows) {
      const key = row.tool_description_normalized.toLowerCase();
      if (!failuresByTool.has(key)) {
        failuresByTool.set(key, new Set());
      }
      failuresByTool.get(key)!.add(row.failure_mode);
    }
    for (const row of standardFailureResult.rows) {
      const key = row.tool_description_normalized.toLowerCase();
      if (!failuresByTool.has(key)) {
        failuresByTool.set(key, new Set());
      }
      failuresByTool.get(key)!.add(row.failure_mode);
    }
    console.log(
      `[Server] Failure-mode sources: ${batchResult.rowCount || 0} historical pairs + ` +
      `${standardFailureResult.rowCount || 0} standards-backed pairs`,
    );

    // Map results back to original tool descriptions
    for (const desc of uniqueDescriptions) {
      const toolDesc = String(desc);
      const lowerTool = toolDesc.toLowerCase();

      // Try exact match
      if (failuresByTool.has(lowerTool)) {
        historicalFailures.set(toolDesc, failuresByTool.get(lowerTool)!);
        console.log(`[Server] Found ${failuresByTool.get(lowerTool)!.size} historical failure modes for ${toolDesc}:`,
          Array.from(failuresByTool.get(lowerTool)!).slice(0, 10));
      } else {
        console.log(`[Server] No exact historical data found for ${toolDesc}`);
      }
    }

    // Step 2: Generate FMEA rows with predicted failure modes
    const draftRows: any[] = [];

    for (const tool of tools) {
      const toolDesc = normalizeToolDescription(tool.toolDescription) || 'Unknown';
      const failures = historicalFailures.get(toolDesc);

      if (failures && failures.size > 0) {
        // Create one row per historical failure mode
        for (const failureMode of failures) {
          draftRows.push({
            // Carry the client's row id so the UI can attribute results back to
            // the exact uploaded row instead of guessing by description.
            toolRowId: tool.id || '',
            toolNo: tool.toolNo || '',
            partDescription: toolDesc,
            potentialFailureMode: failureMode,
            hasEvidence: true,
            material: tool.material || '',
            gateType: tool.gateType || '',
            cavity: tool.cavity || 1
          });
        }
      } else {
        // No historical data - create placeholder
        console.log(`[Server] No historical failures found for ${toolDesc} - creating placeholder`);
        draftRows.push({
          toolRowId: tool.id || '',
          toolNo: tool.toolNo || '',
          partDescription: toolDesc,
          potentialFailureMode: 'No historical data',
          hasEvidence: false,
          material: tool.material || '',
          gateType: tool.gateType || '',
          cavity: tool.cavity || 1
        });
      }
    }

    console.log(`[Server] Generated ${draftRows.length} draft rows from PostgreSQL historical data`);

    // Step 3: Match against PostgreSQL checklist for clean tips
    const matchRequests: Array<{ toolDescription: string; failureMode: string }> = [];

    for (const row of draftRows) {
      if (row.potentialFailureMode && row.potentialFailureMode !== 'No historical data') {
        matchRequests.push({
          toolDescription: row.partDescription,
          failureMode: row.potentialFailureMode
        });
      }
    }

    console.log(`[Server] Matching ${matchRequests.length} failure modes against checklist (batched)`);

    // Use batch matching with optimized single-connection approach
    const checklistMatches = await matchChecklistBatch(matchRequests, 0.55, 5);

    // Log summary statistics only
    let totalMatches = 0;
    let rowsWithMatches = 0;
    checklistMatches.forEach((matches) => {
      if (matches.length > 0) {
        totalMatches += matches.length;
        rowsWithMatches++;
      }
    });
    console.log(`[Server] Checklist match summary: ${rowsWithMatches}/${matchRequests.length} tools have recommendations (${totalMatches} total entries)`);

    // Step 3.5: For tools with NO checklist matches, query knowledge base directly for single records
    const noMatchKeys: string[] = [];
    for (const req of matchRequests) {
      const key = `${req.toolDescription}||${req.failureMode}`;
      if (!checklistMatches.has(key) || checklistMatches.get(key)!.length === 0) {
        noMatchKeys.push(key);
      }
    }

    if (noMatchKeys.length > 0) {
      console.log(`[Server] Querying knowledge base directly for ${noMatchKeys.length} tools with no checklist data...`);

      // One query for every unmatched pair, instead of one query per pair on a
      // dedicated connection. The pairs are passed as a VALUES list and joined
      // against, so this stays a single round-trip however many rows there are.
      const pairs = noMatchKeys.map((key) => {
        const separator = key.lastIndexOf('||');
        return { toolDesc: key.slice(0, separator), failureMode: key.slice(separator + 2) };
      });

      // Explicit ::text casts: parameters inside a VALUES list in a CTE have no
      // inferable type, and Postgres rejects the statement without them.
      const valuesClause = pairs
        .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`)
        .join(', ');
      const valuesParams = pairs.flatMap((pair) => [pair.toolDesc, pair.failureMode]);

      const kbResult = await client.query(`
        WITH wanted(tool_description_normalized, failure_mode) AS (VALUES ${valuesClause}),
        ranked AS (
          SELECT
            kb.id,
            kb.learning,
            kb.final_recommendation,
            kb.failure_id,
            kb.tool_description_normalized,
            kb.failure_mode,
            ROW_NUMBER() OVER (
              PARTITION BY kb.tool_description_normalized, kb.failure_mode
              ORDER BY kb.created_at DESC
            ) AS rank
          FROM fmea_knowledge_base kb
          JOIN wanted w
            ON w.tool_description_normalized = kb.tool_description_normalized
           AND w.failure_mode = kb.failure_mode
        )
        SELECT id, learning, final_recommendation, failure_id,
               tool_description_normalized, failure_mode
        FROM ranked
        WHERE rank <= 5
        ORDER BY tool_description_normalized, failure_mode, rank
      `, valuesParams);

      // Regroup the flat result set back into per-pair synthetic entries.
      const byPair = new Map<string, any[]>();
      for (const row of kbResult.rows) {
        const key = `${row.tool_description_normalized}||${row.failure_mode}`;
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key)!.push(row);
      }

      for (const [key, rows] of byPair) {
        const [toolDesc, failureMode] = [
          key.slice(0, key.lastIndexOf('||')),
          key.slice(key.lastIndexOf('||') + 2),
        ];

        const syntheticEntries = rows.map((row, idx) => ({
          id: `kb-${row.id}`,
          tool_description_normalized: toolDesc,
          tool_category: null,
          failure_mode: failureMode,
          sub_concern_index: idx + 1,
          concern: row.learning || 'Historical observation',
          recommendation: row.final_recommendation || 'Review and address',
          supporting_record_count: 1,
          supporting_record_ids: [row.id],
          supporting_failure_ids: [row.failure_id],
          applicability_scope: 'exact_tool' as const,
          source_types: ['historical_fmea' as const],
          historical_checklist_ids: [],
          supporting_standard_refs: [],
          similarity: 1.0
        }));

        checklistMatches.set(key, syntheticEntries);
      }

      console.log(`[Server] Knowledge base fallback matched ${byPair.size}/${noMatchKeys.length} pairs`);

      // Update stats
      totalMatches = 0;
      rowsWithMatches = 0;
      checklistMatches.forEach((matches) => {
        if (matches.length > 0) {
          totalMatches += matches.length;
          rowsWithMatches++;
        }
      });
      console.log(`[Server] After knowledge base fallback: ${rowsWithMatches}/${matchRequests.length} tools have recommendations (${totalMatches} total entries)`);
    }

    // Step 4: Query historical S/O/D values from PostgreSQL.
    // One GROUP BY query for every failure mode, instead of one serial query
    // each. Keyed by failure mode, then applied to every draft row that uses it.
    const sodByFailureMode = new Map<string, { severity: number; occurrence: number; detection: number }>();

    // Get unique failure modes to minimize queries
    const uniqueFailureModes = new Set<string>();
    for (const row of draftRows) {
      if (row.potentialFailureMode && row.potentialFailureMode !== 'No historical data') {
        uniqueFailureModes.add(row.potentialFailureMode);
      }
    }

    console.log(`[Server] Querying S/O/D for ${uniqueFailureModes.size} unique failure modes from PostgreSQL`);

    if (uniqueFailureModes.size > 0) {
      const sodResult = await client.query(`
        SELECT
          failure_mode,
          AVG(severity) as avg_severity,
          AVG(occurrence) as avg_occurrence,
          AVG(detection) as avg_detection
        FROM fmea_knowledge_base
        WHERE failure_mode = ANY($1::text[])
          AND severity IS NOT NULL
        GROUP BY failure_mode
      `, [[...uniqueFailureModes]]);

      for (const record of sodResult.rows) {
        if (!record.avg_severity) continue;
        sodByFailureMode.set(record.failure_mode, {
          severity: Math.round(Number(record.avg_severity)) || 6,
          occurrence: Math.round(Number(record.avg_occurrence)) || 4,
          detection: Math.round(Number(record.avg_detection)) || 4
        });
      }
    }

    console.log(`[Server] Retrieved S/O/D for ${sodByFailureMode.size} failure modes`);

    // Step 5: Build final FMEA rows with checklist data AND calculated S/O/D
    const finalRows = draftRows.map((draft: any) => {
      const key = `${draft.partDescription}||${draft.potentialFailureMode}`;
      const matches = checklistMatches.get(key) || [];

      // Use checklist data if available
      const bestMatch = matches.length > 0 ? matches[0] : null;

      // Get historical S/O/D or use intelligent defaults
      const sod = sodByFailureMode.get(draft.potentialFailureMode) || {
        severity: getDefaultSeverity(draft.potentialFailureMode),
        occurrence: 4,
        detection: 4
      };
      const sodSource = sodByFailureMode.has(draft.potentialFailureMode) ? 'historical' : 'default';

      const rpn = sod.severity * sod.occurrence * sod.detection;

      return {
        // Collision-free and never empty. The previous
        // `Math.random().toString(36).substring(7)` produced a variable-length
        // suffix (empty for small values), so rows could share a React key and
        // expand/collapse together.
        id: randomUUID(),
        toolRowId: draft.toolRowId,
        toolNo: draft.toolNo,
        partDescription: draft.partDescription,
        // Fields below are the engineer's to fill in. They used to ship
        // constant filler ("Injection Molding", "Design review", ...) that read
        // as analysis in the exported workbook.
        processStep: '',
        potentialFailureMode: draft.potentialFailureMode,
        potentialEffect: '',
        severity: sod.severity,
        potentialCause: bestMatch ? bestMatch.concern : '',
        occurrence: sod.occurrence,
        currentPreventionControl: '',
        currentDetectionControl: '',
        detection: sod.detection,
        rpn: rpn,
        recommendedAction: bestMatch ? bestMatch.recommendation : '',
        responsibleFunction: '',
        targetDate: '',
        /** False when no historical failure mode was found for this tool. */
        hasEvidence: Boolean(draft.hasEvidence),
        /** Whether S/O/D came from historical records or from keyword defaults. */
        sodSource,
        checklistEntries: matches // Clean PostgreSQL checklist tips
      };
    });

    // Sort failure modes by recommendation count (descending)
    finalRows.sort((a, b) => {
      const aCount = a.checklistEntries?.length || 0;
      const bCount = b.checklistEntries?.length || 0;
      return bCount - aCount;
    });

    console.log(`[Server] Returning ${finalRows.length} FMEA rows with calculated S/O/D and checklist data (sorted by recommendation count)`);

    res.json({
      drafts: finalRows,
      metadata: metadata // Echo back the project metadata so frontend can use it
    });
  } catch (error: any) {
    console.error('[Server] Error generating FMEA:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// =============================================================================
// DRAFT PERSISTENCE
// Requires migration/03_create_draft_tables.sql to have been applied.
// =============================================================================

/**
 * Best-effort author attribution. The application has no authentication yet, so
 * this trusts a header a fronting proxy may set. Replace with the authenticated
 * principal once SSO lands — do not treat it as a security boundary.
 */
function getRequestUser(req: express.Request): string | null {
  const header = req.header('X-FMEA-User');
  return header ? header.slice(0, 150) : null;
}

let draftFingerprintSchemaReady: Promise<void> | null = null;

async function ensureDraftFingerprintSchema(): Promise<void> {
  if (!draftFingerprintSchemaReady) {
    draftFingerprintSchemaReady = (async () => {
      const pool = getPgPool();
      await pool.query(
        `ALTER TABLE fmea_draft
         ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64)`,
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_fmea_draft_content_fingerprint
         ON fmea_draft(content_fingerprint)
         WHERE content_fingerprint IS NOT NULL`,
      );
    })();
  }

  return draftFingerprintSchemaReady;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function draftFingerprint(metadata: any, drafts: any[]): string {
  const stableDrafts = drafts.map((row) => {
    const { id: _id, ...rest } = row ?? {};
    return rest;
  });

  return createHash('sha256')
    .update(stableJson({
      metadata: {
        projectName: metadata?.projectName || '',
        sourceFilename: metadata?.sourceFilename || '',
        toolMaker: metadata?.toolMaker || '',
        vendor: metadata?.vendor || '',
        quoteType: metadata?.quoteType || '',
        toyYear: metadata?.toyYear || '',
        revision: metadata?.revision || '',
        toolPlan: metadata?.toolPlan || '',
        setCount: metadata?.setCount || '',
        leadTimeDays: metadata?.leadTimeDays ?? null,
      },
      drafts: stableDrafts,
    }))
    .digest('hex');
}

async function insertDraftRows(connection: pg.PoolClient, draftId: string, drafts: any[]): Promise<void> {
  const columnsPerRow = 11;
  const rowsPerStatement = Math.floor(60000 / columnsPerRow);

  for (let start = 0; start < drafts.length; start += rowsPerStatement) {
    const chunk = drafts.slice(start, start + rowsPerStatement);

    const valuesClause = chunk
      .map((_: unknown, i: number) => {
        const base = i * columnsPerRow;
        return `($${base + 1}::uuid, $${base + 2}::int, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::jsonb)`;
      })
      .join(', ');

    const values = chunk.flatMap((row: any, i: number) => [
      draftId,
      start + i,
      row.toolRowId || null,
      row.toolNo || null,
      row.partDescription || null,
      row.potentialFailureMode || null,
      Number.isFinite(row.severity) ? row.severity : null,
      Number.isFinite(row.occurrence) ? row.occurrence : null,
      Number.isFinite(row.detection) ? row.detection : null,
      Number.isFinite(row.rpn) ? row.rpn : null,
      JSON.stringify(row),
    ]);

    await connection.query(
      `INSERT INTO fmea_draft_row
         (draft_id, row_index, tool_row_id, tool_no, part_description,
          failure_mode, severity, occurrence, detection, rpn, payload)
       VALUES ${valuesClause}`,
      values,
    );
  }
}

/** Save a generated draft and its rows. */
app.post('/api/fmea/draft', async (req, res) => {
  const { metadata = {}, drafts = [], draftId: requestedDraftId = null } = req.body ?? {};

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return res.status(400).json({ error: 'drafts array is required and must not be empty' });
  }

  const pool = getPgPool();
  const connection = await pool.connect();

  try {
    await ensureDraftFingerprintSchema();

    const fingerprint = draftFingerprint(metadata, drafts);

    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [fingerprint]);

    let existingDraftId: string | null = null;
    if (requestedDraftId) {
      const existing = await connection.query(
        `SELECT id FROM fmea_draft WHERE id = $1`,
        [requestedDraftId],
      );
      existingDraftId = existing.rows[0]?.id ?? null;
    }

    if (!existingDraftId) {
      const existing = await connection.query(
        `SELECT id FROM fmea_draft WHERE content_fingerprint = $1`,
        [fingerprint],
      );
      existingDraftId = existing.rows[0]?.id ?? null;
    }

    if (existingDraftId) {
      const draftResult = await connection.query(
        `UPDATE fmea_draft
         SET project_name = $2,
             source_filename = $3,
             metadata = $4,
             created_by = COALESCE(created_by, $5),
             content_fingerprint = $6,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, created_at, updated_at`,
        [
          existingDraftId,
          metadata.projectName || null,
          metadata.sourceFilename || null,
          JSON.stringify(metadata),
          getRequestUser(req),
          fingerprint,
        ],
      );

      await connection.query(`DELETE FROM fmea_draft_row WHERE draft_id = $1`, [existingDraftId]);
      await insertDraftRows(connection, existingDraftId, drafts);

      await connection.query('COMMIT');

      console.log(`[Server] Updated draft ${existingDraftId} with ${drafts.length} rows`);

      return res.status(200).json({
        id: existingDraftId,
        rowCount: drafts.length,
        createdAt: draftResult.rows[0].created_at,
        updatedAt: draftResult.rows[0].updated_at,
        reused: true,
      });
    }

    const draftResult = await connection.query(
      `INSERT INTO fmea_draft (project_name, source_filename, metadata, created_by, content_fingerprint)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at, updated_at`,
      [
        metadata.projectName || null,
        metadata.sourceFilename || null,
        JSON.stringify(metadata),
        getRequestUser(req),
        fingerprint,
      ],
    );

    const draftId = draftResult.rows[0].id;
    await insertDraftRows(connection, draftId, drafts);

    await connection.query('COMMIT');

    console.log(`[Server] Saved draft ${draftId} with ${drafts.length} rows`);

    res.status(201).json({
      id: draftId,
      rowCount: drafts.length,
      createdAt: draftResult.rows[0].created_at,
      updatedAt: draftResult.rows[0].updated_at,
    });
  } catch (error: any) {
    await connection.query('ROLLBACK').catch(() => undefined);
    console.error('[Server] Error saving draft:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    connection.release();
  }
});

/** List saved drafts, most recently updated first. */
app.get('/api/fmea/drafts', async (req, res) => {
  try {
    const limitNum = parseBoundedInt(req.query.limit, 50, 1, 200);

    const result = await getPgPool().query(
      `SELECT
         d.id,
         d.project_name  as "projectName",
         d.source_filename as "sourceFilename",
         d.created_by    as "createdBy",
         d.created_at    as "createdAt",
         d.updated_at    as "updatedAt",
         COUNT(r.id)::int as "rowCount"
       FROM fmea_draft d
       LEFT JOIN fmea_draft_row r ON r.draft_id = d.id
       GROUP BY d.id
       ORDER BY d.updated_at DESC
       LIMIT $1`,
      [limitNum],
    );

    res.json({ drafts: result.rows });
  } catch (error: any) {
    console.error('[Server] Error listing drafts:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/** Load one saved draft with all of its rows. */
app.get('/api/fmea/draft/:id', async (req, res) => {
  try {
    const pool = getPgPool();

    const draftResult = await pool.query(
      `SELECT id, project_name as "projectName", source_filename as "sourceFilename",
              metadata, created_by as "createdBy",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM fmea_draft
       WHERE id = $1`,
      [req.params.id],
    );

    if (draftResult.rows.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const rowsResult = await pool.query(
      `SELECT payload FROM fmea_draft_row WHERE draft_id = $1 ORDER BY row_index ASC`,
      [req.params.id],
    );

    res.json({
      ...draftResult.rows[0],
      drafts: rowsResult.rows.map((row: any) => row.payload),
    });
  } catch (error: any) {
    // An id that is not a UUID reaches Postgres as a cast error rather than a
    // miss, so report it as a bad request instead of a server fault.
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid draft id' });
    }
    console.error('[Server] Error loading draft:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/** Update a single row of a saved draft. */
app.patch('/api/fmea/draft/:id/row/:rowIndex', async (req, res) => {
  try {
    const rowIndex = parseBoundedInt(req.params.rowIndex, -1, 0, 1_000_000);
    if (rowIndex < 0) {
      return res.status(400).json({ error: 'Invalid row index' });
    }

    const row = req.body?.row;
    if (!row || typeof row !== 'object') {
      return res.status(400).json({ error: 'row object is required' });
    }

    const pool = getPgPool();

    const result = await pool.query(
      `UPDATE fmea_draft_row
       SET tool_no = $3,
           part_description = $4,
           failure_mode = $5,
           severity = $6,
           occurrence = $7,
           detection = $8,
           rpn = $9,
           payload = $10,
           updated_at = NOW()
       WHERE draft_id = $1 AND row_index = $2
       RETURNING id`,
      [
        req.params.id,
        rowIndex,
        row.toolNo || null,
        row.partDescription || null,
        row.potentialFailureMode || null,
        Number.isFinite(row.severity) ? row.severity : null,
        Number.isFinite(row.occurrence) ? row.occurrence : null,
        Number.isFinite(row.detection) ? row.detection : null,
        Number.isFinite(row.rpn) ? row.rpn : null,
        JSON.stringify(row),
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Draft row not found' });
    }

    await pool.query('UPDATE fmea_draft SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    res.json({ updated: true });
  } catch (error: any) {
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid draft id' });
    }
    console.error('[Server] Error updating draft row:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Shared SQL fragments for the dashboard.
 *
 * Grouping is on `tool_description_normalized` exactly as stored, because a
 * position suffix identifies a different tool: "Torso FT" and "Torso RR" are
 * separate moulds with separate histories and must not be merged. This is the
 * same key the matcher uses, so the dashboard and the generator finally agree.
 */
const DASHBOARD_RPN = `COALESCE(kb.rpn, 96)`;
const DASHBOARD_FAMILY = `COALESCE(kb.tool_description_normalized, kb.tool_description, 'Unknown')`;
const DASHBOARD_MATERIAL = `COALESCE(t.material, 'ABS')`;
const DASHBOARD_GATE = `COALESCE(t.gate_type, 'Sub gate')`;

/** RPN buckets. Thresholds intentionally match getRpnBucket() on the client. */
const DASHBOARD_BUCKET = `
  CASE
    WHEN ${DASHBOARD_RPN} >= 36 THEN 'Critical'
    WHEN ${DASHBOARD_RPN} >= 27 THEN 'High'
    WHEN ${DASHBOARD_RPN} >= 9  THEN 'Medium'
    ELSE 'Low'
  END
`;

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const pool = getPgPool();

    // Aggregated in SQL. This endpoint used to select every row of
    // fmea_knowledge_base with no LIMIT and count them in JavaScript, so the
    // payload and the latency grew linearly with the knowledge base forever.
    const [failures, families, risk, status, materialGate, totals] = await Promise.all([
      pool.query(`
        SELECT kb.failure_mode AS name, COUNT(*)::int AS count
        FROM fmea_knowledge_base kb
        WHERE kb.failure_mode IS NOT NULL AND kb.failure_mode <> ''
        GROUP BY kb.failure_mode
        ORDER BY COUNT(*) DESC
      `),
      pool.query(`
        SELECT
          ${DASHBOARD_FAMILY} AS name,
          COUNT(*)::int AS count,
          COUNT(DISTINCT kb.failure_mode)::int AS "failureTypes"
        FROM fmea_knowledge_base kb
        GROUP BY ${DASHBOARD_FAMILY}
        ORDER BY COUNT(*) DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT ${DASHBOARD_BUCKET} AS name, COUNT(*)::int AS count
        FROM fmea_knowledge_base kb
        GROUP BY 1
      `),
      pool.query(`
        SELECT COALESCE(kb.status, 'Unknown') AS name, COUNT(*)::int AS count
        FROM fmea_knowledge_base kb
        GROUP BY 1
        ORDER BY COUNT(*) DESC
      `),
      pool.query(`
        SELECT ${DASHBOARD_MATERIAL} || ' / ' || ${DASHBOARD_GATE} AS key, COUNT(*)::int AS count
        FROM fmea_knowledge_base kb
        LEFT JOIN fmea_tools t ON t.tool_no = kb.tool_num
        GROUP BY 1
        ORDER BY COUNT(*) DESC
        LIMIT 8
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS cases,
          COUNT(DISTINCT ${DASHBOARD_FAMILY})::int AS tools,
          COUNT(DISTINCT kb.failure_mode)::int AS "failureModes"
        FROM fmea_knowledge_base kb
      `),
    ]);

    // "Low" is reported even at zero so the risk chart keeps four fixed bars.
    const buckets = ['Low', 'Medium', 'High', 'Critical'];
    const riskByName = new Map(risk.rows.map((r: any) => [r.name, r.count]));

    res.json({
      totals: totals.rows[0],
      failureFrequency: failures.rows,
      partGroups: families.rows,
      riskDistribution: buckets.map((name) => ({ name, count: riskByName.get(name) ?? 0 })),
      statusMix: status.rows,
      materialGate: materialGate.rows,
    });
  } catch (error: any) {
    console.error('[Server] Error fetching dashboard stats:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Paginated rows behind one dashboard segment, for the drill-down drawer.
 * Replaces filtering a full in-memory copy of the knowledge base on the client.
 */
app.get('/api/dashboard/cases', async (req, res) => {
  try {
    const { dimension, value } = req.query;
    const limitNum = parseBoundedInt(req.query.limit, 50, 1, 200);
    const pageNum = parseBoundedInt(req.query.page, 1, 1, 100_000);
    const offset = (pageNum - 1) * limitNum;

    const predicates: Record<string, string> = {
      failure: `kb.failure_mode = $1`,
      family: `${DASHBOARD_FAMILY} = $1`,
      risk: `${DASHBOARD_BUCKET} = $1`,
      status: `COALESCE(kb.status, 'Unknown') = $1`,
      materialGate: `${DASHBOARD_MATERIAL} || ' / ' || ${DASHBOARD_GATE} = $1`,
    };

    const predicate = predicates[String(dimension)];
    if (!predicate) {
      return res.status(400).json({
        error: `dimension must be one of: ${Object.keys(predicates).join(', ')}`,
      });
    }
    if (typeof value !== 'string' || value === '') {
      return res.status(400).json({ error: 'value is required' });
    }

    const pool = getPgPool();

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM fmea_knowledge_base kb
      LEFT JOIN fmea_tools t ON t.tool_no = kb.tool_num
      WHERE ${predicate}
    `, [value]);

    const rowsResult = await pool.query(`
      SELECT
        kb.id AS id,
        kb.toy_num AS "projectCode",
        COALESCE(p.project_name, kb.toy_name) AS "projectName",
        COALESCE(kb.tool_num, 'Unknown') AS "toolNo",
        ${DASHBOARD_FAMILY} AS "toolDescription",
        ${DASHBOARD_FAMILY} AS "normalizedFamily",
        ${DASHBOARD_MATERIAL} AS material,
        ${DASHBOARD_GATE} AS "gateType",
        kb.failure_mode AS failure,
        COALESCE(kb.final_recommendation, 'No Recommendation') AS recommendation,
        COALESCE(kb.severity, 6)::int AS severity,
        COALESCE(kb.occurrence, 4)::int AS occurrence,
        COALESCE(kb.detection, 4)::int AS detection,
        ${DASHBOARD_RPN}::int AS rpn,
        COALESCE(kb.status, 'Unknown') AS status,
        kb.created_at AS "loggedAt"
      FROM fmea_knowledge_base kb
      LEFT JOIN fmea_tools t ON t.tool_no = kb.tool_num
      LEFT JOIN fmea_projects p ON p.project_code = kb.toy_num
      WHERE ${predicate}
      ORDER BY ${DASHBOARD_RPN} DESC, kb.created_at DESC
      LIMIT $2 OFFSET $3
    `, [value, limitNum, offset]);

    const total = countResult.rows[0].total;

    res.json({
      rows: rowsResult.rows.map((row: any) => ({ ...row, id: String(row.id) })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[Server] Error fetching dashboard cases:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// New endpoint for detailed case history with all actions
app.get('/api/dashboard/case/:id/details', async (req, res) => {
  try {
    const pool = getPgPool();
    const caseId = req.params.id;

    if (!caseId) {
      return res.status(400).json({ error: 'Invalid case ID' });
    }

    const timelineResult = await pool.query(`
      SELECT 
        id,
        event_type as type,
        description as text,
        logged_by as "inputBy",
        logged_at as "inputDate"
      FROM fmea_case_timeline
      WHERE knowledge_base_id = $1
      ORDER BY logged_at ASC
    `, [caseId]);
    
    // Group them by type for the frontend
    const recommendations = timelineResult.rows.filter(r => r.type === 'recommendation');
    const firstShot = timelineResult.rows.filter(r => r.type === 'first_shot');
    const firstShotActions = timelineResult.rows.filter(r => r.type === 'first_shot_action');
    const nextShot = timelineResult.rows.filter(r => r.type === 'next_shot');
    const nextShotActions: any[] = [];

    console.log(`[Server] Case ${caseId} details: ${recommendations.length} recommendations, ${firstShot.length} first shots, ${firstShotActions.length} first rec, ${nextShot.length} next shots`);

    res.json({
      recommendations,
      firstShot,
      firstShotActions,
      nextShot,
      nextShotActions
    });
  } catch (error: any) {
    console.error('[Server] Error fetching case details:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// New endpoint for PostgreSQL Knowledge Base
app.get('/api/knowledge/search', async (req, res) => {
  try {
    const {
      query = '',
      toy_name = '',
      tool_description = '',
      tool_category = '',
      failure_mode = '',
      status = '',
      page = 1,
      limit = 50  // Default to 50 for performance
    } = req.query;

    const pool = getPgPool();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (toy_name) {
      conditions.push(`toy_name = $${paramCount}`);
      params.push(toy_name);
      paramCount++;
    }

    if (tool_description) {
      // Match using the pre-normalized column for performance and consistency
      conditions.push(`tool_description_normalized = $${paramCount}`);
      params.push(tool_description);
      paramCount++;
    }

    if (tool_category) {
      conditions.push(`tool_category = $${paramCount}`);
      params.push(tool_category);
      paramCount++;
    }

    if (failure_mode) {
      conditions.push(`failure_mode = $${paramCount}`);
      params.push(failure_mode);
      paramCount++;
    }

    if (status) {
      conditions.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    // Full-text search across multiple fields if query provided
    // Changed to OR logic for better search results
    if (query && typeof query === 'string' && query.trim()) {
      const searchTerm = query.toLowerCase().trim();
      conditions.push(`(
        LOWER(toy_num) LIKE $${paramCount} OR 
        LOWER(toy_name) LIKE $${paramCount} OR 
        LOWER(tool_num) LIKE $${paramCount} OR 
        LOWER(tool_description) LIKE $${paramCount} OR 
        LOWER(tool_category) LIKE $${paramCount} OR 
        LOWER(material_gate) LIKE $${paramCount} OR 
        LOWER(failure_mode) LIKE $${paramCount} OR 
        LOWER(learning) LIKE $${paramCount} OR 
        LOWER(final_recommendation) LIKE $${paramCount}
      )`);
      params.push(`%${searchTerm}%`);
      paramCount++;
    }

    const pageNum = parseBoundedInt(page, 1, 1, 100_000);
    const limitNum = parseBoundedInt(limit, 50, 1, 200);
    const offset = (pageNum - 1) * limitNum;

    // A record without a learning or a recommendation carries nothing useful.
    // This predicate is applied whether or not filters are present: it used to
    // apply only to the unfiltered branch, so selecting any filter could make
    // the reported total go *up* as empty records became visible.
    const allConditions = [
      'learning IS NOT NULL',
      'final_recommendation IS NOT NULL',
      ...conditions,
    ];
    const whereClause = `WHERE ${allConditions.join(' AND ')}`;

    const countSql = `
      SELECT COUNT(*) as total
      FROM fmea_knowledge_base
      ${whereClause}
    `;

    const sql = `
      SELECT
        id,
        toy_num,
        toy_name,
        tool_num,
        tool_description,
        tool_category,
        material_gate,
        failure_mode,
        learning,
        final_recommendation,
        status,
        evidence_images,
        created_at,
        updated_at
      FROM fmea_knowledge_base
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limitNum, offset);

    // Get total count (exclude limit and offset params)
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countSql, countParams);
    const totalRecords = parseInt(countResult.rows[0]?.total || '0');

    console.log('[Server] PostgreSQL Query:', { sql, params });

    const result = await pool.query(sql, params);

    // Transform evidence_images to full URLs (base64 images loaded on-demand)
    const records = result.rows.map((row: any) => ({
      ...row,
      evidence_images: row.evidence_images ? row.evidence_images.map((img: any) => {
        // If img is already an object with url, return it as-is
        if (typeof img === 'object' && img.url) {
          return img.url;
        }
        // Legacy format: just filename, assume Recommendation folder
        if (typeof img === 'string') {
          return `ptmi/INSIDE/Upload/FMEA/Recommendation/${img}`;
        }
        return img;
      }) : [],
      // Base64 images not included - load on-demand via /api/knowledge/:id/images
      evidence_images_base64: []
    }));

    const totalPages = Math.ceil(totalRecords / limitNum);

    console.log(`[Server] PostgreSQL returned ${records.length} records (Page ${pageNum}/${totalPages}, Total: ${totalRecords})`);

    res.json({
      records,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRecords,
        totalPages: totalPages
      }
    });

  } catch (error: any) {
    console.error('[Server] Error querying PostgreSQL:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get filter options for PostgreSQL Knowledge Base
app.get('/api/knowledge/filters', async (req, res) => {
  try {
    const pool = getPgPool();

    // Get distinct values for filter dropdowns
    const toyNamesResult = await pool.query('SELECT DISTINCT toy_name FROM fmea_knowledge_base ORDER BY toy_name');

    // Use the pre-normalized tool descriptions column (updated by populate_normalized_tool_descriptions.ts)
    const toolDescResult = await pool.query(`
      SELECT DISTINCT tool_description_normalized 
      FROM fmea_knowledge_base 
      WHERE tool_description_normalized IS NOT NULL
      ORDER BY tool_description_normalized
    `);

    // Get tool categories
    const toolCategoryResult = await pool.query(`
      SELECT DISTINCT tool_category 
      FROM fmea_knowledge_base 
      WHERE tool_category IS NOT NULL
      ORDER BY tool_category
    `);

    const failureModeResult = await pool.query('SELECT DISTINCT failure_mode FROM fmea_knowledge_base ORDER BY failure_mode');
    const statusResult = await pool.query('SELECT DISTINCT status FROM fmea_knowledge_base ORDER BY status');

    res.json({
      toyNames: toyNamesResult.rows.map((r: any) => r.toy_name),
      toolDescriptions: toolDescResult.rows.map((r: any) => r.tool_description_normalized),
      toolCategories: toolCategoryResult.rows.map((r: any) => r.tool_category),
      failureModes: failureModeResult.rows.map((r: any) => r.failure_mode),
      statuses: statusResult.rows.map((r: any) => r.status),
    });

  } catch (error: any) {
    console.error('[Server] Error fetching filters:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get base64 images for a specific record (on-demand loading for performance)
app.get('/api/knowledge/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPgPool();

    const result = await pool.query(
      'SELECT evidence_images_base64 FROM fmea_knowledge_base WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({
      images: result.rows[0].evidence_images_base64 || []
    });

  } catch (error: any) {
    console.error('[Server] Error fetching images:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get historical FMEA records for a specific tool + failure mode combination
app.get('/api/knowledge/historical-for-failure', async (req, res) => {
  try {
    const {
      toolDescription,
      failureMode,
      limit = 20
    } = req.query;

    if (!toolDescription || !failureMode) {
      return res.status(400).json({
        error: 'toolDescription and failureMode are required'
      });
    }

    const pool = getPgPool();
    const limitNum = parseBoundedInt(limit, 20, 1, 200);

    console.log(`[API] Fetching historical records for: ${toolDescription} / ${failureMode}`);

    const result = await pool.query(
      `SELECT 
        id,
        toy_num,
        toy_name,
        tool_num,
        tool_description,
        tool_description_normalized,
        tool_category,
        material_gate,
        failure_mode,
        learning,
        final_recommendation,
        status,
        created_at,
        updated_at
      FROM fmea_knowledge_base
      WHERE tool_description_normalized = $1
        AND failure_mode = $2
      ORDER BY created_at DESC
      LIMIT $3`,
      [toolDescription, failureMode, limitNum]
    );

    console.log(`[API] Found ${result.rows.length} historical records`);

    res.json({
      records: result.rows,
      totalCount: result.rows.length,
      filters: {
        toolDescription,
        failureMode
      }
    });

  } catch (error: any) {
    console.error('[API] Error fetching historical records:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// =============================================================================
// CHECKLIST ENDPOINTS - Historical FMEA Checklist System
// =============================================================================

/**
 * GET /api/checklist/match
 * Match checklist entries for a single tool + failure mode
 * 
 * Query params:
 * - toolDescription: string (required)
 * - failureMode: string (required)
 * - threshold: number (optional, default 0.75)
 * - limit: number (optional, default 10)
 */
app.get('/api/checklist/match', async (req, res) => {
  try {
    const {
      toolDescription,
      failureMode,
      threshold = 0.75,
      limit = 10
    } = req.query;

    if (!toolDescription || !failureMode) {
      return res.status(400).json({
        error: 'toolDescription and failureMode are required'
      });
    }

    // A NaN threshold made every similarity comparison false, so fuzzy matching
    // silently returned nothing instead of erroring.
    const thresholdNum = parseBoundedFloat(threshold, 0.75, 0, 1);
    const limitNum = parseBoundedInt(limit, 10, 1, 100);

    console.log(`[API] Checklist match request: ${toolDescription} / ${failureMode}`);

    const matches = await matchChecklistEntries(
      toolDescription as string,
      failureMode as string,
      thresholdNum,
      limitNum
    );

    res.json({
      matches,
      count: matches.length,
      toolDescription,
      failureMode
    });

  } catch (error: any) {
    console.error('[API] Error matching checklist:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/checklist/match-batch
 * Match checklist entries for multiple tools (batch operation)
 * 
 * Body:
 * {
 *   tools: [
 *     { toolDescription: string, failureMode: string },
 *     ...
 *   ],
 *   threshold: number (optional, default 0.75),
 *   maxResultsPerTool: number (optional, default 5)
 * }
 */
app.post('/api/checklist/match-batch', async (req, res) => {
  try {
    const {
      tools = [],
      threshold = 0.75,
      maxResultsPerTool = 5
    } = req.body;

    if (!Array.isArray(tools) || tools.length === 0) {
      return res.status(400).json({
        error: 'tools array is required and must not be empty'
      });
    }

    if (tools.length > MAX_TOOLS_PER_REQUEST) {
      return res.status(413).json({
        error: `Too many tools in one request (${tools.length}). The maximum is ${MAX_TOOLS_PER_REQUEST}.`,
      });
    }

    console.log(`[API] Checklist batch match request: ${tools.length} tools`);

    const matchesMap = await matchChecklistBatch(
      tools,
      threshold,
      maxResultsPerTool
    );

    // Convert Map to object for JSON response
    const results: Record<string, any[]> = {};
    matchesMap.forEach((matches, key) => {
      results[key] = matches;
    });

    res.json({
      results,
      totalTools: tools.length,
      totalMatches: Array.from(matchesMap.values()).reduce((sum, arr) => sum + arr.length, 0)
    });

  } catch (error: any) {
    console.error('[API] Error in batch checklist match:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/checklist/stats
 * Get overview statistics for the checklist system
 */
app.get('/api/checklist/stats', async (req, res) => {
  try {
    console.log('[API] Checklist stats request');

    const stats = await getChecklistStats();

    res.json(stats);

  } catch (error: any) {
    console.error('[API] Error fetching checklist stats:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/checklist/failure-modes
 * Get list of all available failure modes
 */
app.get('/api/checklist/failure-modes', async (req, res) => {
  try {
    const result = await getPgPool().query(`
      SELECT DISTINCT failure_mode, COUNT(*) as entry_count
      FROM fmea_checklist_standard
      GROUP BY failure_mode
      ORDER BY failure_mode
    `);

    res.json({
      failureModes: result.rows
    });

  } catch (error: any) {
    console.error('[API] Error fetching failure modes:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

console.log('[Server] Checklist endpoints registered:');
console.log('  GET  /api/checklist/match');
console.log('  POST /api/checklist/match-batch');
console.log('  GET  /api/checklist/stats');
console.log('  GET  /api/checklist/failure-modes');


// Start server
const server = app.listen(port, host, () => {
  console.log(`[Server] API Backend running at http://${host}:${port}`);
  console.log('[Server] All endpoints registered and ready');
});

// Keep process alive
server.on('error', (error: any) => {
  console.error('[Server] Error starting server:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, closing server');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
