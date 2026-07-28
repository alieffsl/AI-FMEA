/**
 * Checklist Service - Semantic matching for historical FMEA checklist
 */

import pg from 'pg';
import { normalizeToolDescription } from './normalizeToolDescription';

const { Client } = pg;

// Position suffixes used for rejection check (tools with suffixes are DIFFERENT tools)
const POSITION_SUFFIXES = ['LT', 'RT', 'FT', 'RR', 'LEFT', 'RIGHT', 'FRONT', 'REAR', 'BACK'];

export interface ChecklistEntry {
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
  similarity?: number;
}

/**
 * Calculate text similarity using both word-level Jaccard and character-level matching.
 * Handles cases like "Hairclip" vs "Hair Clip" where word-level fails.
 * 
 * CRITICAL FIXES:
 * 1. Prevents short tool names (e.g., "Bra") from matching much longer ones (e.g., "Bracelet")
 * 2. Prevents position suffix variants (e.g., "Leg" vs "Leg LT") from matching (user clarification)
 */
function calculateTextSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // POSITION SUFFIX CHECK: Reject matches where one string is just the other + position suffix
  // Example: "Leg" vs "Leg LT", "Torso" vs "Torso FT" should be REJECTED (different tools)
  const wordsA = s1.split(/\s+/);
  const wordsB = s2.split(/\s+/);
  
  if (Math.abs(wordsA.length - wordsB.length) === 1) {
    const shorter = wordsA.length < wordsB.length ? s1 : s2;
    const longer = wordsA.length < wordsB.length ? s2 : s1;
    const longerWords = longer.split(/\s+/);
    const lastWord = longerWords[longerWords.length - 1].toUpperCase();
    
    // Check if longer string is shorter + position suffix
    if (POSITION_SUFFIXES.includes(lastWord)) {
      const longerWithoutSuffix = longerWords.slice(0, -1).join(' ');
      if (longerWithoutSuffix.toLowerCase() === shorter) {
        return 0.0; // REJECT: different tools (e.g., "Torso" ≠ "Torso FT")
      }
    }
  }
  
  // LENGTH RATIO CHECK: Prevent short names from matching much longer ones
  // Example: "Bra" (3 chars) should NOT match "Bracelet" (8 chars)
  const len1 = s1.length;
  const len2 = s2.length;
  const minLen = Math.min(len1, len2);
  const maxLen = Math.max(len1, len2);
  const lengthRatio = minLen / maxLen;
  
  // If one string is very short (≤4 chars) AND much shorter than the other (ratio < 0.6), reject
  if (minLen <= 4 && lengthRatio < 0.6) {
    return 0.0;
  }
  
  // Character-level: check if one contains the other (after removing spaces)
  const s1NoSpace = s1.replace(/\s+/g, '');
  const s2NoSpace = s2.replace(/\s+/g, '');
  
  if (s1NoSpace === s2NoSpace) return 0.95;
  if (s1NoSpace.includes(s2NoSpace) || s2NoSpace.includes(s1NoSpace)) {
    const longer = Math.max(s1NoSpace.length, s2NoSpace.length);
    const shorter = Math.min(s1NoSpace.length, s2NoSpace.length);
    return 0.7 + 0.25 * (shorter / longer);
  }
  
  // Word-level Jaccard similarity
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  
  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection++;
  }
  
  const union = words1.size + words2.size - intersection;
  const jaccardScore = union > 0 ? intersection / union : 0;
  
  // Levenshtein-based similarity on the full strings (character level)
  const maxLenForLev = Math.max(s1.length, s2.length);
  if (maxLenForLev === 0) return 1.0;
  const editDist = levenshteinDistance(s1, s2);
  const levenshteinScore = 1 - (editDist / maxLenForLev);
  
  // Return the higher of the two scores
  return Math.max(jaccardScore, levenshteinScore);
}

/**
 * Simple Levenshtein distance
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Match checklist entries for a given tool description and failure mode.
 * Uses a cascading strategy:
 * 1. Exact match (case-insensitive) on both tool + failure
 * 2. Semantic/fuzzy match on tool with same failure mode
 * 
 * NOTE: Position suffixes (LT, RT, FT, RR) are NOT stripped - tools with different
 * position suffixes are treated as DIFFERENT tools (e.g., "Leg" ≠ "Leg LT")
 */
export async function matchChecklistEntries(
  toolDescription: string,
  failureMode: string,
  similarityThreshold: number = 0.75,
  maxResults: number = 10
): Promise<ChecklistEntry[]> {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Normalize the tool description
    const normalizedTool = normalizeToolDescription(toolDescription);

    // ── Step 1: Exact match (case-insensitive) ──
    const exactMatchResult = await client.query<ChecklistEntry>(`
      SELECT 
        id,
        tool_description_normalized,
        tool_category,
        failure_mode,
        sub_concern_index,
        concern,
        recommendation,
        supporting_record_count,
        supporting_record_ids,
        supporting_failure_ids
      FROM fmea_checklist
      WHERE LOWER(tool_description_normalized) = LOWER($1)
        AND LOWER(failure_mode) = LOWER($2)
      ORDER BY supporting_record_count DESC, sub_concern_index ASC
      LIMIT $3
    `, [normalizedTool, failureMode, maxResults]);

    if (exactMatchResult.rows.length > 0) {
      console.log(`[Checklist] Exact match found: ${exactMatchResult.rows.length} entries for "${normalizedTool}" + "${failureMode}"`);
      return exactMatchResult.rows.map(row => ({
        ...row,
        similarity: 1.0
      }));
    }

    // ── Step 2: Semantic/fuzzy match ──
    console.log(`[Checklist] No exact match for "${normalizedTool}" + "${failureMode}", using semantic search...`);
    
    // Get all checklist entries for the failure mode (case-insensitive)
    const candidatesResult = await client.query<ChecklistEntry>(`
      SELECT 
        id,
        tool_description_normalized,
        tool_category,
        failure_mode,
        sub_concern_index,
        concern,
        recommendation,
        supporting_record_count,
        supporting_record_ids,
        supporting_failure_ids
      FROM fmea_checklist
      WHERE LOWER(failure_mode) = LOWER($1)
    `, [failureMode]);

    if (candidatesResult.rows.length === 0) {
      return [];
    }

    // Compute similarity for each candidate
    // Use a lower threshold for short tool descriptions (1-2 words)
    const wordCount = normalizedTool.split(/\s+/).length;
    const effectiveThreshold = wordCount <= 2 ? Math.min(similarityThreshold, 0.40) : similarityThreshold;
    
    const matches: (ChecklistEntry & { similarity: number })[] = [];
    
    for (const candidate of candidatesResult.rows) {
      const candidateNorm = candidate.tool_description_normalized || '';
      
      // Only compare full normalized forms (no base-word stripping)
      const similarity = calculateTextSimilarity(normalizedTool, candidateNorm);
      
      if (similarity >= effectiveThreshold) {
        matches.push({
          id: candidate.id,
          tool_description_normalized: candidate.tool_description_normalized,
          tool_category: candidate.tool_category,
          failure_mode: candidate.failure_mode,
          sub_concern_index: candidate.sub_concern_index,
          concern: candidate.concern,
          recommendation: candidate.recommendation,
          supporting_record_count: candidate.supporting_record_count,
          supporting_record_ids: candidate.supporting_record_ids,
          supporting_failure_ids: candidate.supporting_failure_ids,
          similarity
        });
      }
    }

    // Sort by similarity and supporting count
    matches.sort((a, b) => {
      if (Math.abs(a.similarity - b.similarity) < 0.05) {
        return b.supporting_record_count - a.supporting_record_count;
      }
      return b.similarity - a.similarity;
    });

    console.log(`[Checklist] Semantic search found ${matches.length} matches (threshold: ${effectiveThreshold})`);
    return matches.slice(0, maxResults);
    
  } finally {
    await client.end();
  }
}

/**
 * Batch match for multiple tools - OPTIMIZED VERSION
 * Uses a single database connection and batches queries for massive performance improvement
 * 
 * NOTE: Position suffixes (LT, RT, FT, RR) are NOT stripped - tools with different
 * position suffixes are treated as DIFFERENT tools (e.g., "Leg" ≠ "Leg LT")
 */
export async function matchChecklistBatch(
  tools: Array<{ toolDescription: string; failureMode: string }>,
  similarityThreshold: number = 0.75,
  maxResultsPerTool: number = 5
): Promise<Map<string, ChecklistEntry[]>> {
  const results = new Map<string, ChecklistEntry[]>();
  
  if (tools.length === 0) {
    return results;
  }

  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Step 1: Normalize all tool descriptions (no base-word stripping)
    const normalizedTools = tools.map(t => ({
      originalTool: t.toolDescription,
      originalFailure: t.failureMode,
      normalized: normalizeToolDescription(t.toolDescription),
      key: `${t.toolDescription}||${t.failureMode}`
    }));

    // Step 2: Build sets for batch queries
    const allNormalizedTools = new Set<string>();
    const allFailureModes = new Set<string>();
    
    for (const tool of normalizedTools) {
      allNormalizedTools.add(tool.normalized.toLowerCase());
      allFailureModes.add(tool.originalFailure.toLowerCase());
    }

    // Step 3: Fetch ALL potential matches in ONE query
    const placeholders = Array.from(allFailureModes).map((_, i) => `$${i + 1}`).join(',');
    const allCandidatesResult = await client.query<ChecklistEntry>(`
      SELECT 
        id,
        tool_description_normalized,
        tool_category,
        failure_mode,
        sub_concern_index,
        concern,
        recommendation,
        supporting_record_count,
        supporting_record_ids,
        supporting_failure_ids
      FROM fmea_checklist
      WHERE LOWER(failure_mode) IN (${placeholders})
      ORDER BY supporting_record_count DESC
    `, Array.from(allFailureModes));

    // Step 4: Process matches for each tool
    for (const tool of normalizedTools) {
      const candidates = allCandidatesResult.rows.filter(
        row => row.failure_mode.toLowerCase() === tool.originalFailure.toLowerCase()
      );

      // Try exact match first
      const exactMatches = candidates.filter(
        row => row.tool_description_normalized.toLowerCase() === tool.normalized.toLowerCase()
      );

      if (exactMatches.length > 0) {
        results.set(tool.key, exactMatches.slice(0, maxResultsPerTool).map(row => ({
          ...row,
          similarity: 1.0
        })));
        continue;
      }

      // Semantic matching (no base-word comparison)
      const wordCount = tool.normalized.split(/\s+/).length;
      const effectiveThreshold = wordCount <= 2 ? Math.min(similarityThreshold, 0.40) : similarityThreshold;
      
      const semanticMatches: (ChecklistEntry & { similarity: number })[] = [];
      
      for (const candidate of candidates) {
        const candidateNorm = candidate.tool_description_normalized || '';
        
        // Only compare full normalized forms (no base-word stripping)
        const similarity = calculateTextSimilarity(tool.normalized, candidateNorm);
        
        if (similarity >= effectiveThreshold) {
          semanticMatches.push({
            ...candidate,
            similarity
          });
        }
      }

      // Sort and limit
      semanticMatches.sort((a, b) => {
        if (Math.abs(a.similarity - b.similarity) < 0.05) {
          return b.supporting_record_count - a.supporting_record_count;
        }
        return b.similarity - a.similarity;
      });

      results.set(tool.key, semanticMatches.slice(0, maxResultsPerTool));
    }
    
    return results;
    
  } finally {
    await client.end();
  }
}

/**
 * Get checklist statistics
 */
export async function getChecklistStats() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const stats = await client.query(`
      SELECT 
        COUNT(DISTINCT (tool_description_normalized, failure_mode)) as unique_groups,
        COUNT(*) as total_entries,
        SUM(supporting_record_count) as total_supporting,
        AVG(supporting_record_count) as avg_supporting,
        MIN(supporting_record_count) as min_supporting,
        MAX(supporting_record_count) as max_supporting,
        COUNT(DISTINCT tool_description_normalized) as unique_tools,
        COUNT(DISTINCT failure_mode) as unique_failure_modes
      FROM fmea_checklist
    `);

    const topTools = await client.query(`
      SELECT 
        tool_description_normalized,
        tool_category,
        COUNT(*) as entry_count,
        SUM(supporting_record_count) as total_records
      FROM fmea_checklist
      GROUP BY tool_description_normalized, tool_category
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    const topFailureModes = await client.query(`
      SELECT 
        failure_mode,
        COUNT(*) as entry_count,
        SUM(supporting_record_count) as total_records
      FROM fmea_checklist
      GROUP BY failure_mode
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    return {
      overview: stats.rows[0],
      topTools: topTools.rows,
      topFailureModes: topFailureModes.rows
    };
  } finally {
    await client.end();
  }
}
