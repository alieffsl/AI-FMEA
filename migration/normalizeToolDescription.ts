/**
 * Tool Description Normalization — CANONICAL SOURCE
 *
 * These rules are the ones that populated
 * `fmea_knowledge_base.tool_description_normalized`, so the API must apply the
 * exact same rules or exact-match lookups silently miss their evidence.
 *
 * This file is duplicated byte-for-byte in three places:
 *
 *   src/utils/normalizeToolDescription.ts   (ESM, bundler resolution)
 *   server/normalizeToolDescription.ts      (CommonJS, rootDir "./")
 *   migration/normalizeToolDescription.ts   (ESM, explicit .js specifiers)
 *
 * A single shared module would require moving the server's `rootDir`, which
 * moves the deployed entry point from `dist/index.js` to `dist/server/index.js`
 * and breaks `deploy/ecosystem.config.cjs`. Until that move is scheduled, the
 * copies are kept honest by `src/utils/normalizeToolDescription.drift.test.ts`,
 * which fails if any two copies differ.
 *
 * To change the rules: edit one copy, copy it verbatim over the other two, run
 * `npm test`, then re-run `npm --prefix migration run normalize:populate` so the
 * database column matches the new rules.
 */

const POSITION_SUFFIXES = ['LT', 'RT', 'FT', 'RR', 'LEFT', 'RIGHT', 'FRONT', 'REAR', 'BACK'];
const PRESERVE_UPPERCASE = ['LT', 'RT', 'FT', 'RR', 'NS', 'FS', 'MQ', 'KD', 'ID'];

// Canonical display names for single-word tool descriptions.
//
// This is NOT a word splitter. Only terms genuinely written as two words in
// normal English are split — "hairclip" is the sole such entry. Everything else
// maps to itself in title case, because they are ordinary single words.
// Mechanically decomposing them produced wrong output ("anklet" became
// "Ankle T") and, worse, changed the join key used against
// tool_description_normalized in both the knowledge base and the checklist.
const COMPOUND_WORDS: Record<string, string> = {
  'hairclip': 'Hair Clip',
  'headband': 'Headband',
  'earring': 'Earring',
  'necklace': 'Necklace',
  'backpack': 'Backpack',
  'handbag': 'Handbag',
  'footwear': 'Footwear',
  'eyewear': 'Eyewear',
  'sunglasses': 'Sunglasses',
  'shoelace': 'Shoelace',
  'wristband': 'Wristband',
  'armband': 'Armband',
  'anklet': 'Anklet',
  'bodysuit': 'Bodysuit',
  'ponytail': 'Ponytail',
};

// Common singular/plural pairs that should be merged
const PLURALIZATION_RULES: Record<string, string> = {
  'accessories': 'Accessory',
  'arches': 'Arch',
  'bangles': 'Bangle',
  'boots': 'Boot',
  'bracelets': 'Bracelet',
  'clips': 'Clip',
  'earrings': 'Earring',
  'flowers': 'Flower',
  'gloves': 'Glove',
  'hands': 'Hand',
  'legs': 'Leg',
  'shoes': 'Shoe',
  'wings': 'Wing',
};

/**
 * Normalize a tool description for consistent matching
 *
 * Rules (in order):
 * 1. Strip leading tool number patterns (e.g., "JJB33-001-torso-ft" → "torso-ft")
 * 2. Replace hyphens, underscores, periods with spaces
 * 3. Split camelCase/PascalCase compounds
 * 4. Resolve known compound words
 * 5. Title Case with special uppercase preservation
 * 6. Apply confident pluralization merges
 *
 * @param raw - Raw tool description from database
 * @returns Normalized tool description
 */
export function normalizeToolDescription(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';

  let normalized = raw.trim();

  // Step 1: Strip leading tool number patterns
  // Pattern A: Two hyphen-separated groups (e.g., "JJB33-001-", "V6986-2879-").
  // The letter/digit counts are deliberately wider than Pattern A2 below: this
  // shape (code, then a numeric group, then the description) is unambiguous, so
  // it is safe to accept 1-5 letters. Narrowing it to [A-Z]{3} previously left
  // the tool number embedded in descriptions such as
  // "V6986-2879-Kelly-big-bow-shoes".
  normalized = normalized.replace(/^[A-Z]{1,5}\d{2,5}-\d{3,4}-/i, '');
  // Pattern A2: A single hyphen-separated group (e.g., "JDR48-"). Kept narrow
  // at exactly 3 letters, because widening it here would also strip legitimate
  // part codes that are not tool numbers (e.g. "FP21009-TORSO FT").
  normalized = normalized.replace(/^[A-Z]{3}\d{2,3}-/i, '');

  // Pattern B: Space-separated (e.g., "Jjb33 001 Torso Ft" or "Jtv75 001 Pet Toy")
  // Match: 3-5 letters followed by 2-5 digits, then space, then 3-4 digits, then space
  normalized = normalized.replace(/^[A-Za-z]{3,5}\d{2,5}\s+\d{3,4}\s+/i, '');

  // Pattern C: Simple prefix (e.g., "Y7557 Something" or "ABC12 Something")
  // Match: Letters+digits at start followed by space (only if no descriptive word yet)
  normalized = normalized.replace(/^[A-Z]{1,5}\d{2,5}\s+/i, '');

  // Step 2: Replace separators with spaces
  normalized = normalized.replace(/[._-]+/g, ' ');

  // Step 2.5: Split camelCase and PascalCase compound words (e.g., "HairClip" -> "Hair Clip")
  // Insert space before uppercase letters that follow lowercase letters
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Step 3: Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  if (!normalized) return 'Unknown';

  // Step 3.5: Check if single word matches known compound word (case-insensitive)
  const words = normalized.split(' ');
  if (words.length === 1) {
    const lower = words[0].toLowerCase();
    if (COMPOUND_WORDS[lower]) {
      return COMPOUND_WORDS[lower];
    }
  }

  // Step 4: Title Case with special handling
  normalized = toTitleCaseWithPreservation(normalized);

  // Step 5: Apply pluralization rules
  const lower = normalized.toLowerCase();
  if (PLURALIZATION_RULES[lower]) {
    normalized = PLURALIZATION_RULES[lower];
  }

  return normalized;
}

/**
 * Convert to Title Case while preserving specific uppercase terms
 */
function toTitleCaseWithPreservation(text: string): string {
  return text
    .split(' ')
    .map(word => {
      const upper = word.toUpperCase();

      // Preserve specific technical terms
      if (PRESERVE_UPPERCASE.includes(upper)) {
        return upper;
      }

      // Title case: first letter uppercase, rest lowercase
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Extract position suffix from tool description
 * Returns the suffix (LT, RT, FT, RR) or null if none found
 */
export function extractPositionSuffix(toolDescription: string): string | null {
  const words = toolDescription.trim().split(/\s+/);
  const lastWord = words[words.length - 1]?.toUpperCase();

  if (lastWord && POSITION_SUFFIXES.includes(lastWord)) {
    return lastWord;
  }

  return null;
}

/**
 * Check if two tool descriptions are the same after normalization,
 * accounting for position suffixes
 */
export function isSameToolDescription(desc1: string, desc2: string): boolean {
  const norm1 = normalizeToolDescription(desc1);
  const norm2 = normalizeToolDescription(desc2);

  // Exact match
  if (norm1 === norm2) return true;

  // Check if they differ only by position suffix
  const suffix1 = extractPositionSuffix(norm1);
  const suffix2 = extractPositionSuffix(norm2);

  if (suffix1 && suffix2 && suffix1 !== suffix2) {
    // Different position suffixes - these are different parts
    return false;
  }

  // Remove suffixes and compare
  const base1 = suffix1 ? norm1.replace(new RegExp(`\\s+${suffix1}$`, 'i'), '') : norm1;
  const base2 = suffix2 ? norm2.replace(new RegExp(`\\s+${suffix2}$`, 'i'), '') : norm2;

  return base1 === base2;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching and duplicate detection
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

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
