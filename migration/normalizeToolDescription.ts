/**
 * Tool Description Normalization
 * 
 * Shared normalization function for consistent tool description matching
 * across the checklist system and knowledge base.
 */

const POSITION_SUFFIXES = ['LT', 'RT', 'FT', 'RR', 'LEFT', 'RIGHT', 'FRONT', 'REAR', 'BACK'];
const PRESERVE_UPPERCASE = ['LT', 'RT', 'FT', 'RR', 'NS', 'FS', 'MQ', 'KD', 'ID'];

// Known compound words that should be split
const COMPOUND_WORDS: Record<string, string> = {
  'hairclip': 'Hair Clip',
  'headband': 'Head Band',
  'earring': 'Ear Ring',
  'necklace': 'Neck Lace',
  'backpack': 'Back Pack',
  'handbag': 'Hand Bag',
  'footwear': 'Foot Wear',
  'eyewear': 'Eye Wear',
  'sunglasses': 'Sun Glasses',
  'shoelace': 'Shoe Lace',
  'wristband': 'Wrist Band',
  'armband': 'Arm Band',
  'anklet': 'Ankle T',
  'bodysuit': 'Body Suit',
  'ponytail': 'Pony Tail',
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
 * 3. Collapse multiple spaces
 * 4. Title Case with special uppercase preservation
 * 5. Apply confident pluralization merges
 * 
 * @param raw - Raw tool description from database
 * @returns Normalized tool description
 */
export function normalizeToolDescription(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  
  let normalized = raw.trim();
  
  // Step 1: Strip leading tool number patterns
  // Pattern A: Hyphen-separated (e.g., "JJB33-001-", "JDR48-")
  normalized = normalized.replace(/^[A-Z]{3}\d{2,3}-\d{3,4}-/i, '');
  normalized = normalized.replace(/^[A-Z]{3}\d{2,3}-/i, '');
  
  // Pattern B: Space-separated (e.g., "Jjb33 001 Torso Ft" or "Jtv75 001 Pet Toy")
  // Match: 3-5 letters followed by 2-5 digits, then space, then 3-4 digits, then space
  normalized = normalized.replace(/^[A-Za-z]{3,5}\d{2,5}\s+\d{3,4}\s+/i, '');
  
  // Pattern C: Simple prefix (e.g., "Y7557 Something" or "ABC12 Something")
  // Match: Letters+digits at start followed by space (only if no descriptive word yet)
  normalized = normalized.replace(/^[A-Z]{1,5}\d{2,5}\s+/i, '');
  
  // Step 2: Replace separators with spaces
  normalized = normalized.replace(/[._-]+/g, ' ');
  
  // Step 2.5: Split camelCase and PascalCase compound words (e.g., "Hairclip" -> "Hair clip")
  // Insert space before uppercase letters that follow lowercase letters
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Step 3: Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  if (!normalized) return 'Unknown';
  
  // Step 3.5: Check if single word matches known compound word (case-insensitive)
  let words = normalized.split(' ');
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
