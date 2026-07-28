/**
 * Normalize tool description for consistent matching
 * Same logic as backend/migration normalizeToolDescription
 */

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

export function normalizeToolDescription(rawDescription: string | null | undefined): string {
  if (!rawDescription) return 'Unknown';
  
  let s = rawDescription.trim();
  
  // 1. Strip tool number prefix patterns
  // Pattern A: Hyphen-separated (e.g., "JLK25-U832-01-" or "JJB33-001-")
  s = s.replace(/^[A-Z]{2,}[\d-]+[A-Z]?[\d-]+-/i, '');
  
  // Pattern B: Space-separated (e.g., "Jjb33 001 Torso Ft" or "Jtv75 001 Pet Toy")
  // Match: 3-5 letters followed by 2-5 digits, then space, then 3-4 digits, then space
  s = s.replace(/^[A-Za-z]{3,5}\d{2,5}\s+\d{3,4}\s+/i, '');
  
  // Pattern C: Simple prefix (e.g., "Y7557 Something" or "ABC12 Something")
  // Match: Letters+digits at start followed by space (only if no descriptive word yet)
  s = s.replace(/^[A-Z]{1,5}\d{2,5}\s+/i, '');
  
  // 2. Replace separators with spaces
  s = s.replace(/[._-]+/g, ' ');
  
  // 3. Split camelCase and PascalCase compound words (e.g., "HairClip" -> "Hair Clip")
  // Insert space before uppercase letters that follow lowercase letters
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // 4. Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();
  
  if (!s) return 'Unknown';
  
  // 5. Check if single word matches known compound word (case-insensitive)
  let words = s.split(' ');
  if (words.length === 1) {
    const lower = words[0].toLowerCase();
    if (COMPOUND_WORDS[lower]) {
      return COMPOUND_WORDS[lower];
    }
  }
  
  // 6. Title Case with position suffix preservation
  const normalized = words.map((word) => {
    const upper = word.toUpperCase();
    
    // Preserve uppercase for known position/side suffixes
    if (['LT', 'RT', 'FT', 'RR', 'NS', 'FS', 'L', 'R', 'F'].includes(upper)) {
      return upper;
    }
    
    // Confident pluralization rules
    const lower = word.toLowerCase();
    if (lower === 'shoes') return 'Shoe';
    if (lower === 'accessories') return 'Accessory';
    if (lower === 'hands') return 'Hand';
    if (lower === 'feet') return 'Foot';
    if (lower === 'legs') return 'Leg';
    if (lower === 'arms') return 'Arm';
    
    // Default: Title Case
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  
  return normalized.join(' ');
}
