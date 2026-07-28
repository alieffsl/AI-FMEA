/**
 * Automated Local Synthesis for All 6,485 Records
 * Processes records in batches and generates PostgreSQL INSERT statements
 * Features redundancy elimination between Learning and Recommendation
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

interface Record {
  failureId: number;
  toyNum: string;
  toyName: string;
  toolNum: string;
  toolDescription: string;
  materialGate: string;
  failureMode: string;
  status: string;
  initialRecommendations: Array<{text: string; img: string | null}>;
  firstShot: Array<{finding: string; img: string | null}>;
  firstShotActions: Array<{recommendation: string; img: string | null}>;
  nextShot: Array<{finding?: string; recommendation?: string; img: string | null}>;
}

// --- HELPER FUNCTIONS ---

/**
 * Removes duplicate or highly overlapping strings from an array.
 */
function deduplicateStrings(arr: string[]): string[] {
  const unique = new Set<string>();
  const result: string[] = [];
  
  for (const str of arr) {
    const lowerStr = str.toLowerCase();
    const isDuplicate = Array.from(unique).some(
      existing => existing === lowerStr || existing.includes(lowerStr) || lowerStr.includes(existing)
    );
    
    if (!isDuplicate) {
      unique.add(lowerStr);
      result.push(str);
    }
  }
  
  return result;
}

/**
 * Capitalizes the first letter and ensures the string ends with a period.
 */
function formatSentence(text: string): string {
  if (!text) return '';
  let formatted = text.trim();
  formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  if (!formatted.endsWith('.')) {
    formatted += '.';
  }
  return formatted;
}

/**
 * Checks if two strings are fundamentally the same engineering command
 * Used to prevent the Learning column from repeating the Final Recommendation
 */
function isSimilar(str1: string, str2: string): boolean {
  if (!str1 || !str2) return false;
  
  const stripWords = (s: string) => 
    s.toLowerCase()
      .replace(/\b(please|suggest|propose|ensure|apply|add|change|we|should|will|use)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  
  const s1 = stripWords(str1);
  const s2 = stripWords(str2);
  
  if (s1.length < 5 || s2.length < 5) return false;
  
  return s1.includes(s2) || s2.includes(s1);
}

// Common noise patterns for both functions
const sharedNoisePatterns = [
  /please\s+(open|see|refer|check|look)\s+/gi,
  /see\s+(attached|image|photo|picture|file)/gi,
  /refer\s+to\s+(photo|image|attachment|file|FPG|CR color sample)/gi,
  /look\s+at\s+(the\s+)?(photo|image|file|attachment)/gi,
  /check\s+(the\s+)?(NS|FS|next\s+shot|first\s+shot)\s+tab/gi,
  /as\s+per\s+(image|photo|attachment|below|above)/gi,
  /kd\s*->\s*out of dimension,?\s*/gi,
  /cav(ity)? number\s*->\s*/gi,
  /manifested as\s+(other|current part|white mark|improper function|first shot failure|improper assembly)\.?\s*/gi,
  /\b(ok|okay|yes|noted|roger|will\s+do|understood|good|thanks?|thank\s+you)\b\.?\s*$/gi,
];

// --- SYNTHESIS FUNCTIONS ---

function synthesizeRecommendation(record: Record): string {
  const pendingPatterns = [
    /waiting\s+for/gi,
    /pending|to\s+be\s+confirmed|awaiting|under\s+review/gi,
    /will\s+(check|verify|confirm|test)/gi,
    /NS\s+pending|FS\s+pending/gi,
  ];
  
  function cleanAction(text: string): string {
    if (!text) return '';
    let cleaned = text.trim();
    
    sharedNoisePatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    cleaned = cleaned.replace(/^(please|kindly|we\s+should|suggest\s+to|propose\s+to|recommend|i\s+suggest|ensure)\s+/gi, '');
    cleaned = cleaned.replace(/\b(ok|okay|noted|roger|will\s+do|understood|good|thanks?|thank\s+you)\b/gi, '');
    
    return cleaned.trim();
  }
  
  function isPending(text: string): boolean {
    return pendingPatterns.some(pattern => pattern.test(text));
  }
  
  function isPhysicalAction(text: string): boolean {
    const actionIndicators = /\b(increase|decrease|reduce|remove|add|modify|adjust|change|polish|grind|cut|machine|drill|mill|apply|insert|replace|relocate|extend|shorten|widen|narrow|make|flat|radius|clearance)\b/gi;
    const measurementIndicators = /\d+(\.\d+)?\s*(mm|μm|g|kg|degree|°)/i;
    return actionIndicators.test(text) || measurementIndicators.test(text);
  }
  
  // Priority order: newest to oldest
  const allActions = [
    ...record.nextShot.map(n => (n as any).recommendation || (n as any).finding).filter(Boolean),
    ...record.firstShotActions.map(a => a.recommendation).filter(Boolean),
    ...record.initialRecommendations.map(r => r.text).filter(Boolean),
  ];
  
  // Step 1: Clean actions and filter out obvious noise/pending states
  const cleanedActions = allActions
    .map(cleanAction)
    .filter(action => 
      action && 
      action.length > 5 && // Lowered to catch short commands like "Keep it"
      !isPending(action)
    );
  
  if (cleanedActions.length > 0) {
    // Step 2: Try to find a strict physical action first (Best Case)
    const physicalActions = cleanedActions.filter(isPhysicalAction);
    
    // Step 3: If no physical action exists, just take the most recent clean recommendation (Fallback)
    let finalAction = physicalActions.length > 0 ? physicalActions[0] : cleanedActions[0];
    
    // Formatting cleanup
    finalAction = formatSentence(finalAction)
      .replace(/\s+/g, ' ')
      .replace(/\.\s*\./g, '.');
    
    return finalAction;
  }
  
  // Step 4: If literally everything was filtered out, return empty string to keep DB clean
  return "";
}

function synthesizeLearning(record: Record, finalRecommendation: string): string {
  function cleanText(text: string): string {
    if (!text) return '';
    let cleaned = text.trim();
    
    sharedNoisePatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    // Remove standalone acknowledgments
    if (cleaned.match(/^(ok|okay|yes|noted|roger|will do|understood|good|thanks|thank you)$/i)) {
      return '';
    }
    
    return cleaned.trim();
  }
  
  // Separate pure findings (Symptoms) from Recommendations (Actions)
  const findingsRaw = [
    ...record.firstShot.map(f => f.finding),
    ...record.nextShot.map(n => (n as any).finding)
  ].filter(Boolean);
  
  const actionsRaw = [
    ...record.initialRecommendations.map(r => r.text),
    ...record.firstShotActions.map(a => a.recommendation),
    ...record.nextShot.map(n => (n as any).recommendation)
  ].filter(Boolean);
  
  const cleanFindings = deduplicateStrings(
    findingsRaw.map(cleanText).filter(t => t.length > 5)
  );
  
  const cleanActions = deduplicateStrings(
    actionsRaw.map(cleanText).filter(t => t.length > 5)
  );
  
  // CORE FIX: Remove the Final Recommendation from the Learning text
  const intermediateActions = cleanActions.filter(action => {
    return !isSimilar(action, finalRecommendation);
  });
  
  const progressionParts: string[] = [];
  
  // Build the "Observed" section
  if (cleanFindings.length > 0) {
    progressionParts.push(`Observed issue: ${cleanFindings.map(formatSentence).join(' ')}`);
  }
  
  // Build the "Action" section (only non-final actions)
  if (intermediateActions.length > 0) {
    const label = cleanFindings.length > 0 ? "Intermediate evaluations:" : "Evaluated actions:";
    progressionParts.push(`${label} ${intermediateActions.map(formatSentence).join(' ')}`);
  }
  
  // Smart Fallback: If everything was filtered out because it perfectly matched the Final Rec
  if (progressionParts.length === 0) {
    const partName = record.toolDescription ? record.toolDescription.toLowerCase() : "component";
    return `Inspection for ${record.failureMode.toLowerCase()} on ${partName}.`;
  }
  
  // Final cleanup for punctuation spacing
  return progressionParts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/:\s*\./g, ':')
    .trim();
}

function collectImages(record: Record): Array<{filename: string; source: string}> {
  const images: Array<{filename: string; source: string}> = [];
  
  record.initialRecommendations.forEach(r => {
    if (r.img) images.push({ filename: r.img, source: 'Recommendation' });
  });
  
  record.firstShot.forEach(f => {
    if (f.img) images.push({ filename: f.img, source: 'First' });
  });
  
  record.firstShotActions.forEach(a => {
    if (a.img) images.push({ filename: a.img, source: 'FirstRec' });
  });
  
  record.nextShot.forEach(n => {
    if (n.img) images.push({ filename: n.img, source: 'Next' });
  });
  
  return images;
}

function escapeSQL(str: string): string {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

async function synthesizeAndInsert(startIndex: number = 0, batchSize: number = 100): Promise<void> {
  const client = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('[Synthesize] Loading raw data...');
    const rawDataPath = path.join(__dirname, 'raw_fmea_data.json');
    const rawData = await fs.readFile(rawDataPath, 'utf-8');
    const allRecords: Record[] = JSON.parse(rawData);
    
    console.log(`[Synthesize] Total records: ${allRecords.length}`);
    console.log(`[Synthesize] Processing from index ${startIndex}, batch size ${batchSize}`);
    
    await client.connect();
    console.log('[Synthesize] Connected to PostgreSQL');
    
    const endIndex = Math.min(startIndex + batchSize, allRecords.length);
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    
    for (let i = startIndex; i < endIndex; i++) {
      const record = allRecords[i];
      
      try {
        // Evaluate Recommendation First
        const recommendation = synthesizeRecommendation(record);
        
        // Pass the recommendation into Learning to filter out redundancies
        const learning = synthesizeLearning(record, recommendation);
        
        const images = collectImages(record);
        
        const imagesJson = JSON.stringify(images.map(img => ({
          filename: img.filename,
          url: `ptmi/INSIDE/Upload/FMEA/${img.source}/${img.filename}`
        })));
        
        const insertSQL = `
          INSERT INTO fmea_knowledge_base (
            toy_num, toy_name, tool_num, tool_description, material_gate, failure_mode,
            learning, final_recommendation, status, evidence_images
          ) VALUES (
            '${escapeSQL(record.toyNum || 'Unknown')}',
            '${escapeSQL(record.toyName)}',
            '${escapeSQL(record.toolNum || 'Unknown')}',
            '${escapeSQL(record.toolDescription)}',
            '${escapeSQL(record.materialGate)}',
            '${escapeSQL(record.failureMode)}',
            '${escapeSQL(learning)}',
            '${escapeSQL(recommendation)}',
            '${escapeSQL(record.status)}',
            '${escapeSQL(imagesJson)}'::jsonb
          );
        `;
        
        await client.query(insertSQL);
        inserted++;
        
        if ((i + 1) % 10 === 0) {
          console.log(`[Synthesize] Progress: ${i + 1}/${endIndex} (${inserted} inserted, ${skipped} skipped, ${errors} errors)`);
        }
        
      } catch (error: any) {
        if (error.code === '23505') {
          skipped++;
        } else {
          console.error(`[Synthesize] Error on record ${record.failureId}:`, error.message);
          errors++;
        }
      }
    }
    
    console.log('\n[Synthesize] ═══════════════════════════════');
    console.log(`[Synthesize] ✅ Batch complete!`);
    console.log(`[Synthesize] Inserted: ${inserted}`);
    console.log(`[Synthesize] Skipped: ${skipped}`);
    console.log(`[Synthesize] Errors: ${errors}`);
    console.log(`[Synthesize] ═══════════════════════════════\n`);
    
    const countResult = await client.query('SELECT COUNT(*) FROM fmea_knowledge_base');
    console.log(`[Synthesize] Total records in database: ${countResult.rows[0].count}`);
    
  } catch (error) {
    console.error('[Synthesize] Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Command line args: node synthesize_all.ts [startIndex] [batchSize]
const startIndex = parseInt(process.argv[2]) || 0;
const batchSize = parseInt(process.argv[3]) || 100;

console.log('[Synthesize] Starting automated synthesis...');
console.log(`[Synthesize] Start Index: ${startIndex}`);
console.log(`[Synthesize] Batch Size: ${batchSize}\n`);

synthesizeAndInsert(startIndex, batchSize)
  .then(() => {
    console.log('[Synthesize] 🎉 Synthesis complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Synthesize] 💥 Synthesis failed:', error);
    process.exit(1);
  });

export { synthesizeAndInsert };
