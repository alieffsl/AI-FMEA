// Quick test for normalizeToolDescription
// Run: npx ts-node --esm test_normalize.ts

// Inline import to avoid ESM resolution issues
import { normalizeToolDesc, extractCategory } from './normalizeToolDescription.ts';

const testCases: Array<[string, string, string]> = [
  ['JJB33-001-torso-ft', 'Torso FT', 'Torso'],
  ['Snake-Body', 'Snake Body', 'Snake Body'],
  ['Snake Body LT', 'Snake Body LT', 'Snake Body'],
  ['SNAKE_BODY.FT', 'Snake Body FT', 'Snake Body'],
  ['accessories', 'Accessory', 'Accessory'],
  ['accessory', 'Accessory', 'Accessory'],
  ['FP21009-TORSO FT', 'Torso FT', 'Torso'],
  ['torso', 'Torso', 'Torso'],
  ['Dog Body LT', 'Dog Body LT', 'Dog Body'],
  ['1f', '1f', '1f'],
  ['arch', 'Arch', 'Arch'],
  ['arches', 'Arches', 'Arches'],
  ['bracelet', 'Bracelet', 'Bracelet'],
  ['bracelets', 'Bracelet', 'Bracelet'],
];

console.log('Tool Description Normalization Tests\n');
let passed = 0;
let failed = 0;

for (const [input, expectedNorm, expectedCat] of testCases) {
  const actualNorm = normalizeToolDesc(input);
  const actualCat = extractCategory(actualNorm);
  const normOk = actualNorm === expectedNorm;
  const catOk = actualCat === expectedCat;

  if (normOk && catOk) {
    console.log(`  ✓ "${input}" → "${actualNorm}" [cat: "${actualCat}"]`);
    passed++;
  } else {
    console.log(`  ✗ "${input}"`);
    if (!normOk) console.log(`    normalize: expected "${expectedNorm}", got "${actualNorm}"`);
    if (!catOk) console.log(`    category: expected "${expectedCat}", got "${actualCat}"`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
