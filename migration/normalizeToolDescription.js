/**
 * Tool Description Normalization
 *
 * Shared normalization function for consistent tool description matching
 * across the checklist system and knowledge base.
 */
const POSITION_SUFFIXES = ['LT', 'RT', 'FT', 'RR', 'LEFT', 'RIGHT', 'FRONT', 'REAR', 'BACK'];
const PRESERVE_UPPERCASE = ['LT', 'RT', 'FT', 'RR', 'NS', 'FS', 'MQ', 'KD', 'ID'];
// Common singular/plural pairs that should be merged
const PLURALIZATION_RULES = {
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
export function normalizeToolDescription(raw) {
    if (!raw)
        return 'Unknown';
    let normalized = raw.trim();
    // Step 1: Strip leading tool number patterns
    // Patterns: JJB33-001-, JDR48-, etc.
    normalized = normalized.replace(/^[A-Z]{3}\d{2,3}-\d{3,4}-/i, '');
    normalized = normalized.replace(/^[A-Z]{3}\d{2,3}-/i, '');
    // Step 2: Replace separators with spaces
    normalized = normalized.replace(/[._-]+/g, ' ');
    // Step 3: Collapse multiple spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();
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
function toTitleCaseWithPreservation(text) {
    return text
        .split(' ')
        .map(word => {
        const upper = word.toUpperCase();
        // Preserve specific technical terms
        if (PRESERVE_UPPERCASE.includes(upper)) {
            return upper;
        }
        // Title case: first letter uppercase, rest lowercase
        if (word.length === 0)
            return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
        .join(' ');
}
/**
 * Extract position suffix from tool description
 * Returns the suffix (LT, RT, FT, RR) or null if none found
 */
export function extractPositionSuffix(toolDescription) {
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
export function isSameToolDescription(desc1, desc2) {
    const norm1 = normalizeToolDescription(desc1);
    const norm2 = normalizeToolDescription(desc2);
    // Exact match
    if (norm1 === norm2)
        return true;
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
export function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[len1][len2];
}
