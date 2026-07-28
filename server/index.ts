import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import { matchChecklistEntries, matchChecklistBatch, getChecklistStats } from './checklistService';
import { normalizeToolDescription } from './normalizeToolDescription';

dotenv.config({ path: '../migration/.env' });

const { Client, Pool } = pg;

const app = express();
const port = 3001;

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

// Generic string normalization function for Tool Descriptions
function cleanToolDescription(desc: string | null): string {
  if (!desc) return 'Unknown';

  // 1. Take everything before a dash or comma
  let s = desc.split(/[-,]/)[0].trim();

  // 2. Extract the very first word
  let firstWord = s.split(' ')[0].trim();

  // 3. Remove any symbols or numbers attached to the noun (e.g. "BELT#1" -> "BELT")
  firstWord = firstWord.replace(/[^a-zA-Z]/g, '').toLowerCase();

  // 4. Handle extreme typos
  if (firstWord === 'bellt') firstWord = 'belt';
  if (firstWord === 'bagg') firstWord = 'bag';

  // Fallback if empty
  if (!firstWord) {
    firstWord = desc.replace(/[^a-zA-Z]/g, '').toLowerCase() || 'unknown';
  }

  // 5. Singularize common plurals safely
  const knownPlurals: Record<string, string> = {
    'shoes': 'shoe',
    'earrings': 'earring',
    'accessories': 'accessory',
    'boxes': 'box',
    'brushes': 'brush',
    'watches': 'watch',
    'glasses': 'glass',
    'lenses': 'lens',
    'cases': 'case',
  };

  if (knownPlurals[firstWord]) {
    firstWord = knownPlurals[firstWord];
  } else if (firstWord.endsWith('s') && !firstWord.endsWith('ss') && !firstWord.endsWith('es') && !firstWord.endsWith('us') && !firstWord.endsWith('is')) {
    // Strip 's' only for simple plurals (e.g., bags -> bag).
    // Avoid 'es' to prevent accidentally mangling words.
    firstWord = firstWord.slice(0, -1);
  }

  // 6. Title Case
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

app.post('/api/fmea/generate', async (req, res) => {
  try {
    const tools = req.body.tools || [];
    const metadata = req.body.metadata || {};

    if (!tools.length) {
      return res.status(400).json({ error: 'No tools provided.' });
    }

    console.log(`[Server] Received ${tools.length} NEW tools (CDI format) for FMEA generation`);
    console.log(`[Server] Project metadata:`, metadata);

    // Step 1: Query PostgreSQL to find historical failures for similar tools
    const client = new Client({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT || '5432'),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

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

    // Group results by tool description
    const failuresByTool = new Map<string, Set<string>>();
    for (const row of batchResult.rows) {
      const key = row.tool_description_normalized.toLowerCase();
      if (!failuresByTool.has(key)) {
        failuresByTool.set(key, new Set());
      }
      failuresByTool.get(key)!.add(row.failure_mode);
    }

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

    await client.end();

    // Step 2: Generate FMEA rows with predicted failure modes
    const draftRows: any[] = [];

    for (const tool of tools) {
      const toolDesc = normalizeToolDescription(tool.toolDescription) || 'Unknown';
      const failures = historicalFailures.get(toolDesc);

      if (failures && failures.size > 0) {
        // Create one row per historical failure mode
        for (const failureMode of failures) {
          draftRows.push({
            toolNo: tool.toolNo || '',
            partDescription: toolDesc,
            potentialFailureMode: failureMode,
            material: tool.material || '',
            gateType: tool.gateType || '',
            cavity: tool.cavity || 1
          });
        }
      } else {
        // No historical data - create placeholder
        console.log(`[Server] No historical failures found for ${toolDesc} - creating placeholder`);
        draftRows.push({
          toolNo: tool.toolNo || '',
          partDescription: toolDesc,
          potentialFailureMode: 'No historical data',
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

      const pgClient = new pg.Client({
        host: process.env.PG_HOST,
        port: parseInt(process.env.PG_PORT || '5432'),
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: process.env.PG_DATABASE,
        ssl: { rejectUnauthorized: false },
      });

      await pgClient.connect();

      try {
        for (const key of noMatchKeys) {
          const [toolDesc, failureMode] = key.split('||');

          // Query knowledge base for this exact combination
          const kbResult = await pgClient.query(`
            SELECT 
              id,
              learning,
              final_recommendation,
              failure_id
            FROM fmea_knowledge_base
            WHERE tool_description_normalized = $1
              AND failure_mode = $2
            LIMIT 5
          `, [toolDesc, failureMode]);

          if (kbResult.rows.length > 0) {
            // Convert knowledge base records to checklist-like format
            const syntheticEntries = kbResult.rows.map((row, idx) => ({
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
              similarity: 1.0
            }));

            checklistMatches.set(key, syntheticEntries);
            console.log(`  ✓ Found ${syntheticEntries.length} knowledge base records for ${toolDesc} / ${failureMode}`);
          }
        }
      } finally {
        await pgClient.end();
      }

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

    // Step 4: Query historical S/O/D values from PostgreSQL (batched)
    const pgPoolForSod = getPgPool();
    const historicalSOD = new Map<string, { severity: number; occurrence: number; detection: number }>();

    // Get unique failure modes to minimize queries
    const uniqueFailureModes = new Set<string>();
    for (const row of draftRows) {
      if (row.potentialFailureMode && row.potentialFailureMode !== 'No historical data') {
        uniqueFailureModes.add(row.potentialFailureMode);
      }
    }

    console.log(`[Server] Querying S/O/D for ${uniqueFailureModes.size} unique failure modes from PostgreSQL`);

    for (const failureMode of uniqueFailureModes) {
      try {
        const sodResult = await pgPoolForSod.query(`
          SELECT 
            AVG(severity) as avg_severity,
            AVG(occurrence) as avg_occurrence,
            AVG(detection) as avg_detection
          FROM fmea_knowledge_base
          WHERE failure_mode = $1
            AND severity IS NOT NULL
        `, [failureMode]);

        if (sodResult.rows.length > 0 && sodResult.rows[0].avg_severity) {
          const record = sodResult.rows[0];
          const sod = {
            severity: Math.round(Number(record.avg_severity)) || 6,
            occurrence: Math.round(Number(record.avg_occurrence)) || 4,
            detection: Math.round(Number(record.avg_detection)) || 4
          };

          // Store for ALL tools with this failure mode
          for (const row of draftRows) {
            if (row.potentialFailureMode === failureMode) {
              const key = `${row.partDescription}||${row.potentialFailureMode}`;
              historicalSOD.set(key, sod);
            }
          }
        }
      } catch (error) {
        console.error(`[Server] Error querying S/O/D for ${failureMode}:`, error);
      }
    }

    console.log(`[Server] Retrieved S/O/D for ${historicalSOD.size} tool-failure combinations`);

    // Step 5: Build final FMEA rows with checklist data AND calculated S/O/D
    const finalRows = draftRows.map((draft: any) => {
      const key = `${draft.partDescription}||${draft.potentialFailureMode}`;
      const matches = checklistMatches.get(key) || [];

      // Use checklist data if available
      const bestMatch = matches.length > 0 ? matches[0] : null;

      // Get historical S/O/D or use intelligent defaults
      const sod = historicalSOD.get(key) || {
        severity: getDefaultSeverity(draft.potentialFailureMode),
        occurrence: 4,
        detection: 4
      };

      const rpn = sod.severity * sod.occurrence * sod.detection;

      return {
        id: Math.random().toString(36).substring(7),
        toolRowId: draft.toolNo,
        toolNo: draft.toolNo,
        partDescription: draft.partDescription,
        processStep: 'Injection Molding',
        potentialFailureMode: draft.potentialFailureMode,
        potentialEffect: bestMatch ? 'Part quality issue - see checklist' : 'Potential failure',
        severity: sod.severity,
        potentialCause: bestMatch ? bestMatch.concern : 'Based on historical data',
        occurrence: sod.occurrence,
        currentPreventionControl: 'Design review',
        currentDetectionControl: 'Visual inspection',
        detection: sod.detection,
        rpn: rpn,
        recommendedAction: bestMatch ? bestMatch.recommendation : 'Review historical cases',
        responsibleFunction: 'Tooling Engineer',
        targetDate: '',
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

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const pool = getPgPool();
    
    // 1. Fetch Projects
    const toysResult = await pool.query(`SELECT id, project_code as "projectCode", project_name as "projectName" FROM fmea_projects`);
    const projects = toysResult.rows;

    // 2. Fetch Historical Cases
    const casesResult = await pool.query(`
      SELECT 
        kb.id as id,
        p.project_code as "projectCode",
        p.project_name as "projectName",
        t.tool_no as "toolNo",
        COALESCE(kb.tool_description_normalized, kb.tool_description) as "toolDescription",
        COALESCE(t.material, 'ABS') as material,
        COALESCE(t.mold_material, 'P20') as "moldMaterial",
        COALESCE(t.gate_type, 'Sub gate') as "gateType",
        COALESCE(t.cavity, 1) as cavity,
        COALESCE(t.part_weight_g, 10) as "partWeightG",
        kb.failure_mode as failure,
        'Tool design' as stage,
        COALESCE(kb.final_recommendation, 'No Recommendation') as recommendation,
        'No first shot finding' as "firstShotFinding",
        'No first shot action' as "firstShotRecommendation",
        COALESCE(kb.severity, 6) as severity,
        COALESCE(kb.occurrence, 4) as occurrence,
        COALESCE(kb.detection, 4) as detection,
        COALESCE(kb.rpn, 96) as rpn,
        kb.status as status,
        'Live DB' as "sourceTag",
        1 as "sourcePage",
        'Action' as "actionFamily",
        '' as notes,
        kb.created_at as "loggedAt",
        kb.evidence_images as evidence_images
      FROM fmea_knowledge_base kb
      LEFT JOIN fmea_tools t ON t.tool_no = kb.tool_num
      LEFT JOIN fmea_projects p ON p.project_code = kb.toy_num
    `);
    
    const historicalCases = casesResult.rows.map((c: any) => {
      const cleanDesc = cleanToolDescription(c.toolDescription);
      
      let imgUrl = undefined;
      if (c.evidence_images && Array.isArray(c.evidence_images) && c.evidence_images.length > 0) {
        const img = c.evidence_images[0];
        if (typeof img === 'string') {
          imgUrl = img.startsWith('http') ? img : `http://${img}`;
        } else if (img && typeof img === 'object' && img.url) {
          imgUrl = img.url;
        }
      }

      return {
        ...c,
        id: c.id.toString(),
        toolNo: c.toolNo ? c.toolNo.toString() : 'Unknown',
        toolDescription: cleanDesc,
        rpn: parseInt(c.rpn) || 0,
        severity: parseInt(c.severity) || 0,
        occurrence: parseInt(c.occurrence) || 0,
        detection: parseInt(c.detection) || 0,
        normalizedFamily: cleanDesc,
        imageUrl: imgUrl
      };
    });

    res.json({ projects, historicalCases });
  } catch (error: any) {
    console.error('[Server] Error fetching dashboard stats:', error);
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

    let sql: string;
    let countSql: string;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const offset = (pageNum - 1) * limitNum;

    // If no filters/query, return records in consistent order
    if (conditions.length === 0) {
      // Count total records
      countSql = `
        SELECT COUNT(*) as total
        FROM fmea_knowledge_base
        WHERE learning IS NOT NULL 
          AND final_recommendation IS NOT NULL
      `;

      sql = `
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
        WHERE learning IS NOT NULL 
          AND final_recommendation IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;
      params.push(limitNum, offset);
    } else {
      // With filters/query, use standard search with pagination
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      countSql = `
        SELECT COUNT(*) as total
        FROM fmea_knowledge_base
        ${whereClause}
      `;

      sql = `
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
    }

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
    const limitNum = parseInt(limit as string) || 20;

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

    const thresholdNum = parseFloat(threshold as string);
    const limitNum = parseInt(limit as string);

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
    const client = new Client({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT || '5432'),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    const result = await client.query(`
      SELECT DISTINCT failure_mode, COUNT(*) as entry_count
      FROM fmea_checklist
      GROUP BY failure_mode
      ORDER BY failure_mode
    `);

    await client.end();

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
const server = app.listen(port, () => {
  console.log(`[Server] API Backend running at http://localhost:${port}`);
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
